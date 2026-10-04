import type { SessionUser } from "./auth";
import { hasPermission } from "./authz";
import { ensurePublishJob } from "./publishing";

export interface OperationsEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  PUBLISH_QUEUE: Queue<any>;
  GENERATION_QUEUE: Queue<any>;
  ENVIRONMENT?: string;
  AUTH_PEPPER?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  OPENAI_API_KEY?: string;
  SOCIAL_TOKEN_KEY?: string;
  PUBLIC_BASE_URL?: string;
}

export async function recordSystemEvent(
  env: OperationsEnv,
  input: {
    severity: "info"|"warning"|"error"|"critical";
    category: string;
    eventType: string;
    entityType?: string;
    entityId?: string;
    message: string;
    metadata?: unknown;
  }
){
  const recent = input.entityType && input.entityId
    ? await env.DB.prepare(
        `SELECT id FROM system_events
         WHERE event_type=? AND entity_type=? AND entity_id=? AND resolved_at IS NULL
         AND created_at >= datetime('now','-30 minutes')
         LIMIT 1`
      ).bind(input.eventType,input.entityType,input.entityId).first()
    : null;
  if(recent)return;

  await env.DB.prepare(
    `INSERT INTO system_events
     (id,severity,category,event_type,entity_type,entity_id,message,metadata_json)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID(),input.severity,input.category,input.eventType,
    input.entityType||null,input.entityId||null,input.message,
    input.metadata===undefined?null:JSON.stringify(input.metadata)
  ).run();
}

export async function readiness(env:OperationsEnv){
  const checks:Array<{name:string;ok:boolean;detail:string}>=[];
  try{
    await env.DB.prepare("SELECT 1 AS ok").first();
    checks.push({name:"database",ok:true,detail:"D1 reachable"});
  }catch(error){
    checks.push({name:"database",ok:false,detail:error instanceof Error?error.message:"D1 unavailable"});
  }

  try{
    await env.MEDIA.head("__brandsparq_healthcheck__");
    checks.push({name:"media",ok:true,detail:"R2 binding reachable"});
  }catch(error){
    checks.push({name:"media",ok:false,detail:error instanceof Error?error.message:"R2 unavailable"});
  }

  const required=[
    ["AUTH_PEPPER",env.AUTH_PEPPER],
    ["GOOGLE_CLIENT_ID",env.GOOGLE_CLIENT_ID],
    ["GOOGLE_CLIENT_SECRET",env.GOOGLE_CLIENT_SECRET],
    ["RESEND_API_KEY",env.RESEND_API_KEY],
    ["OPENAI_API_KEY",env.OPENAI_API_KEY],
    ["SOCIAL_TOKEN_KEY",env.SOCIAL_TOKEN_KEY],
    ["PUBLIC_BASE_URL",env.PUBLIC_BASE_URL],
  ] as const;
  const missing=required.filter(([,value])=>!value).map(([name])=>name);
  checks.push({
    name:"configuration",
    ok:missing.length===0,
    detail:missing.length?`Missing: ${missing.join(", ")}`:"Required production configuration present",
  });

  const ok=checks.every(check=>check.ok);
  return {ok,service:"brandsparq-api",environment:env.ENVIRONMENT||"unknown",checks,timestamp:new Date().toISOString()};
}

export async function recoverStaleWork(env:OperationsEnv){
  const stalePublish=await env.DB.prepare(
    `SELECT id,post_id,attempt_count,max_attempts,last_error
     FROM publish_jobs
     WHERE status='publishing'
       AND claimed_at < datetime('now','-15 minutes')
     LIMIT 50`
  ).all<any>();

  for(const job of stalePublish.results){
    if(Number(job.attempt_count)>=Number(job.max_attempts)){
      const now=new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE publish_jobs SET status='failed',completed_at=?,last_error=COALESCE(last_error,'Publishing worker timed out.'),updated_at=? WHERE id=?`
        ).bind(now,now,job.id),
        env.DB.prepare(
          `UPDATE posts SET status='failed',failure_code='WORKER_TIMEOUT',failure_message='Publishing worker timed out.',updated_at=? WHERE id=? AND status='publishing'`
        ).bind(now,job.post_id),
      ]);
      await recordSystemEvent(env,{severity:"error",category:"publishing",eventType:"publish_job_timed_out",entityType:"publish_job",entityId:job.id,message:"Publish job exhausted attempts after a stale worker claim.",metadata:{postId:job.post_id}});
    }else{
      await env.DB.prepare(
        `UPDATE publish_jobs SET status='retrying',claimed_at=NULL,last_error=COALESCE(last_error,'Recovered stale publishing claim.'),updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(job.id).run();
      await env.PUBLISH_QUEUE.send({kind:"publish",publishJobId:job.id,postId:job.post_id,executionKey:`recovery:${job.id}`},{delaySeconds:30});
      await recordSystemEvent(env,{severity:"warning",category:"publishing",eventType:"publish_job_recovered",entityType:"publish_job",entityId:job.id,message:"Recovered and requeued a stale publishing job.",metadata:{postId:job.post_id}});
    }
  }

  const staleGeneration=await env.DB.prepare(
    `SELECT id,status,stage FROM generation_jobs
     WHERE status IN ('queued','running')
       AND COALESCE(stage_updated_at,created_at) < datetime('now','-30 minutes')
     LIMIT 25`
  ).all<any>();

  for(const job of staleGeneration.results){
    await env.DB.prepare(
      `UPDATE generation_jobs SET status='queued',stage='queued',stage_updated_at=CURRENT_TIMESTAMP,last_error='Recovered stale generation job.' WHERE id=?`
    ).bind(job.id).run();
    await env.GENERATION_QUEUE.send({kind:"generate",jobId:job.id},{delaySeconds:30});
    await recordSystemEvent(env,{severity:"warning",category:"generation",eventType:"generation_job_recovered",entityType:"generation_job",entityId:job.id,message:"Recovered and requeued a stale generation job.",metadata:{stage:job.stage}});
  }

  await env.DB.prepare("DELETE FROM request_rate_limits WHERE window_started_at < ?")
    .bind(Date.now()-24*60*60*1000).run();

  return {publishRecovered:stalePublish.results.length,generationRecovered:staleGeneration.results.length};
}

export async function getSystemOverview(env:OperationsEnv){
  const [health,publish,generation,failedPosts,events,social]=await Promise.all([
    readiness(env),
    env.DB.prepare(
      `SELECT status,COUNT(*) AS count FROM publish_jobs
       WHERE created_at>=datetime('now','-7 days') GROUP BY status`
    ).all<any>(),
    env.DB.prepare(
      `SELECT status,COUNT(*) AS count FROM generation_jobs
       WHERE created_at>=datetime('now','-7 days') GROUP BY status`
    ).all<any>(),
    env.DB.prepare(
      `SELECT p.id,p.title,p.platform,p.failure_code,p.failure_message,p.updated_at,c.name AS client_name
       FROM posts p JOIN clients c ON c.id=p.client_id
       WHERE p.status='failed' ORDER BY p.updated_at DESC LIMIT 20`
    ).all<any>(),
    env.DB.prepare(
      `SELECT * FROM system_events
       WHERE resolved_at IS NULL ORDER BY
       CASE severity WHEN 'critical' THEN 1 WHEN 'error' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
       created_at DESC LIMIT 50`
    ).all<any>(),
    env.DB.prepare(
      `SELECT status,COUNT(*) AS count FROM social_accounts GROUP BY status`
    ).all<any>(),
  ]);
  return {
    health,
    publishJobs:publish.results,
    generationJobs:generation.results,
    failedPosts:failedPosts.results,
    events:events.results,
    socialAccounts:social.results,
  };
}

export async function handleOperationsRoute(
  request:Request,url:URL,env:OperationsEnv,user:SessionUser
):Promise<{body:unknown;status?:number}|null>{
  if(!url.pathname.startsWith("/v1/system"))return null;
  if(!hasPermission(user,"system_manage"))return {body:{error:"Owner access is required for system operations."},status:403};

  if(request.method==="GET"&&url.pathname==="/v1/system/overview"){
    return {body:{data:await getSystemOverview(env)}};
  }

  if(request.method==="POST"&&url.pathname==="/v1/system/recover"){
    const result=await recoverStaleWork(env);
    await env.DB.prepare(
      `INSERT INTO recovery_actions (id,actor_user_id,action,entity_type,entity_id,metadata_json)
       VALUES (?,?,'recover_stale','system','brandsparq',?)`
    ).bind(crypto.randomUUID(),user.id,JSON.stringify(result)).run();
    return {body:{ok:true,data:result}};
  }

  const retryPost=url.pathname.match(/^\/v1\/system\/posts\/([^/]+)\/retry$/);
  if(request.method==="POST"&&retryPost){
    const post=await env.DB.prepare(
      "SELECT id,status,scheduled_publish_at,publish_version FROM posts WHERE id=?"
    ).bind(retryPost[1]).first<any>();
    if(!post)return {body:{error:"Post not found."},status:404};
    if(post.status!=="failed")return {body:{error:"Only failed posts can be retried from System Health."},status:409};

    const now=new Date().toISOString();
    await env.DB.prepare(
      `UPDATE posts SET status='calendar_scheduled',failure_code=NULL,failure_message=NULL,publish_version=publish_version+1,updated_at=? WHERE id=?`
    ).bind(now,post.id).run();
    const job=await ensurePublishJob(env,post.id,post.scheduled_publish_at||now);
    if(job.shouldEnqueue){
      await env.PUBLISH_QUEUE.send({kind:"publish",publishJobId:job.jobId,postId:post.id,executionKey:job.executionKey});
    }
    await env.DB.prepare(
      `INSERT INTO recovery_actions (id,actor_user_id,action,entity_type,entity_id,previous_state,next_state,metadata_json)
       VALUES (?,?,'retry_failed_post','post',?,'failed','calendar_scheduled',?)`
    ).bind(crypto.randomUUID(),user.id,post.id,JSON.stringify({publishJobId:job.jobId})).run();
    return {body:{ok:true,publishJobId:job.jobId}};
  }

  const resolveEvent=url.pathname.match(/^\/v1\/system\/events\/([^/]+)\/resolve$/);
  if(request.method==="POST"&&resolveEvent){
    await env.DB.prepare("UPDATE system_events SET resolved_at=CURRENT_TIMESTAMP WHERE id=?").bind(resolveEvent[1]).run();
    await env.DB.prepare(
      `INSERT INTO recovery_actions (id,actor_user_id,action,entity_type,entity_id,next_state)
       VALUES (?,?,'resolve_event','system_event',?,'resolved')`
    ).bind(crypto.randomUUID(),user.id,resolveEvent[1]).run();
    return {body:{ok:true}};
  }

  return {body:{error:"System route not found."},status:404};
}

export async function enforceRateLimit(
  env:OperationsEnv,bucket:string,limit:number,windowMs:number
){
  const now=Date.now();
  const row=await env.DB.prepare(
    "SELECT window_started_at,request_count FROM request_rate_limits WHERE bucket=?"
  ).bind(bucket).first<{window_started_at:number;request_count:number}>();

  if(!row||now-row.window_started_at>=windowMs){
    await env.DB.prepare(
      `INSERT INTO request_rate_limits (bucket,window_started_at,request_count,updated_at)
       VALUES (?,?,1,CURRENT_TIMESTAMP)
       ON CONFLICT(bucket) DO UPDATE SET window_started_at=excluded.window_started_at,request_count=1,updated_at=CURRENT_TIMESTAMP`
    ).bind(bucket,now).run();
    return {allowed:true,remaining:limit-1,retryAfter:0};
  }

  if(row.request_count>=limit){
    return {allowed:false,remaining:0,retryAfter:Math.max(1,Math.ceil((windowMs-(now-row.window_started_at))/1000))};
  }

  await env.DB.prepare(
    "UPDATE request_rate_limits SET request_count=request_count+1,updated_at=CURRENT_TIMESTAMP WHERE bucket=?"
  ).bind(bucket).run();
  return {allowed:true,remaining:Math.max(0,limit-row.request_count-1),retryAfter:0};
}

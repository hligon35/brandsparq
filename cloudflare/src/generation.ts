import {
  AI_PROMPT_VERSION,
  CAPTION_REWRITE_INSTRUCTIONS,
  CREATIVE_DIRECTOR_INSTRUCTIONS,
  IMAGE_DIRECTOR_INSTRUCTIONS,
} from "./ai/prompts";
import {
  createImageResponse,
  createStructuredResponse,
  type InputContent,
  type OpenAIEnv,
} from "./ai/openai";

export type GenerationEnv = OpenAIEnv & {
  DB: D1Database;
  MEDIA: R2Bucket;
  AUTH_PEPPER?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_FROM_NAME?: string;
  REVIEW_NOTIFICATION_EMAIL?: string;
  REVIEW_BASE_URL?: string;
};

type Platform = "instagram" | "facebook" | "linkedin" | "tiktok" | "x";
type AssetRow = { id:string; r2_key:string; filename:string; content_type:string; size_bytes?:number|null };

type GeneratedPost = {
  platform: Platform;
  headline: string;
  caption: string;
  hashtags: string[];
  cta: string;
  objective: string;
  visualDirection: string;
  suggestedPublishAt: string;
  sparqScore: number;
};

type GeneratedCampaign = {
  campaignName: string;
  summary: string;
  posts: GeneratedPost[];
};

const CAMPAIGN_SCHEMA = {
  type:"object",
  additionalProperties:false,
  required:["campaignName","summary","posts"],
  properties:{
    campaignName:{type:"string"},
    summary:{type:"string"},
    posts:{
      type:"array",
      minItems:3,
      maxItems:5,
      items:{
        type:"object",
        additionalProperties:false,
        required:["platform","headline","caption","hashtags","cta","objective","visualDirection","suggestedPublishAt","sparqScore"],
        properties:{
          platform:{type:"string",enum:["instagram","facebook","linkedin","tiktok","x"]},
          headline:{type:"string"},
          caption:{type:"string"},
          hashtags:{type:"array",items:{type:"string"},maxItems:12},
          cta:{type:"string"},
          objective:{type:"string"},
          visualDirection:{type:"string"},
          suggestedPublishAt:{type:"string"},
          sparqScore:{type:"integer",minimum:0,maximum:100}
        }
      }
    }
  }
};

const REWRITE_SCHEMA = {
  type:"object",
  additionalProperties:false,
  required:["headline","caption","hashtags"],
  properties:{
    headline:{type:"string"},
    caption:{type:"string"},
    hashtags:{type:"array",items:{type:"string"},maxItems:12}
  }
};

function bytesToHex(bytes:Uint8Array){return [...bytes].map(v=>v.toString(16).padStart(2,"0")).join("");}
async function sha256(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}
function randomToken(bytes=32){const value=new Uint8Array(bytes);crypto.getRandomValues(value);return bytesToHex(value);}
async function reviewTokenHash(token:string,env:GenerationEnv){return sha256(`${env.AUTH_PEPPER||""}:review:${token}`);}
function toBase64(buffer:ArrayBuffer){
  const bytes=new Uint8Array(buffer);let binary="";const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
}
function fallbackSlot(index:number){
  const date=new Date(Date.now()+(index+1)*86400000);
  date.setUTCHours([14,18,22][index%3],0,0,0);
  return date.toISOString();
}
function err(error:unknown){return error instanceof Error?error.message:"Unknown AI error";}
function clamp(value:number){return Math.max(0,Math.min(100,Math.round(Number(value)||0)));}

function brandContext(row:any){
  return {
    clientName:row.client_name,
    timezone:row.timezone||"America/Indiana/Indianapolis",
    voice:row.voice||"clear, useful, confident",
    audience:row.audience||"general audience",
    primaryColor:row.primary_color||"",
    secondaryColor:row.secondary_color||"",
    website:row.website||"",
    tagline:row.tagline||"",
    preferredCtas:row.preferred_ctas||"",
    imageryPreferences:row.imagery_preferences||"",
    postingRules:row.posting_rules||"",
    restrictedWords:row.restricted_words||""
  };
}

async function logAiRun(env:GenerationEnv,entry:{
  jobId?:string;postId?:string;kind:string;model:string;responseId?:string;
  requestId?:string;status:"completed"|"failed";usage?:unknown;metadata?:unknown;error?:string;
}){
  try{
    await env.DB.prepare(
      "INSERT INTO ai_runs (id,generation_job_id,post_id,kind,provider,model,prompt_version,response_id,provider_request_id,status,usage_json,metadata_json,error_message,completed_at) VALUES (?,?,?,?,'openai',?,?,?,?,?,?,?,?,?)"
    ).bind(
      crypto.randomUUID(),entry.jobId||null,entry.postId||null,entry.kind,entry.model,
      AI_PROMPT_VERSION,entry.responseId||null,entry.requestId||null,entry.status,
      entry.usage?JSON.stringify(entry.usage):null,
      entry.metadata?JSON.stringify(entry.metadata):null,
      entry.error?entry.error.slice(0,1500):null,new Date().toISOString()
    ).run();
  }catch{}
}

async function loadAssets(env:GenerationEnv,ids:string[]){
  if(!ids.length)return [] as AssetRow[];
  const marks=ids.map(()=>"?").join(",");
  const rows=await env.DB.prepare(
    `SELECT id,r2_key,filename,content_type,size_bytes FROM assets WHERE id IN (${marks})`
  ).bind(...ids).all<AssetRow>();
  return rows.results;
}

async function toImageInputs(env:GenerationEnv,assets:AssetRow[],limit=3){
  const out:Array<{type:"input_image";image_url:string}>=[];
  for(const asset of assets.slice(0,limit)){
    if(!asset.content_type?.startsWith("image/"))continue;
    if((asset.size_bytes||0)>4*1024*1024)continue;
    const object=await env.MEDIA.get(asset.r2_key);if(!object)continue;
    out.push({type:"input_image",image_url:`data:${asset.content_type};base64,${toBase64(await object.arrayBuffer())}`});
  }
  return out;
}

async function loadPost(env:GenerationEnv,postId:string){
  return env.DB.prepare(
    `SELECT p.*,c.name AS client_name,c.timezone,
      bp.voice,bp.audience,bp.primary_color,bp.secondary_color,bp.website,
      bp.tagline,bp.preferred_ctas,bp.imagery_preferences,bp.posting_rules,bp.restricted_words
      FROM posts p JOIN clients c ON c.id=p.client_id
      LEFT JOIN brand_profiles bp ON bp.client_id=p.client_id WHERE p.id=?`
  ).bind(postId).first<any>();
}

async function postSourceAssets(env:GenerationEnv,postId:string){
  const rows=await env.DB.prepare(
    `SELECT a.id,a.r2_key,a.filename,a.content_type,a.size_bytes
     FROM post_assets pa JOIN assets a ON a.id=pa.asset_id
     WHERE pa.post_id=? AND pa.role='source' ORDER BY a.created_at ASC`
  ).bind(postId).all<AssetRow>();
  return rows.results;
}

async function generateGraphic(
  env:GenerationEnv,
  post:any,
  generated:GeneratedPost,
  images:Array<{type:"input_image";image_url:string}>,
  instruction?:string,
  edit=false
){
  const prompt=[
    "Create a polished 4:5 social-media graphic.",
    `Platform: ${generated.platform}`,
    `Campaign objective: ${generated.objective}`,
    `Headline: ${generated.headline}`,
    `CTA: ${generated.cta}`,
    `Visual direction: ${generated.visualDirection}`,
    instruction?`Requested change: ${instruction}`:"",
    "Brand context JSON:",
    JSON.stringify(brandContext(post)),
    "Use supplied images as source/reference material where appropriate.",
    "Do not place the full caption inside the graphic."
  ].filter(Boolean).join("\n");

  const result=await createImageResponse(env,{
    instructions:IMAGE_DIRECTOR_INSTRUCTIONS,
    prompt,
    images,
    action:edit?"edit":"auto",
    imageModel:edit?(env.OPENAI_IMAGE_EDIT_MODEL||"gpt-image-2.5-sunburst"):(env.OPENAI_IMAGE_MODEL||"gpt-image-2.5-flare")
  });

  const key=`generated/${post.client_id}/${post.id}/${crypto.randomUUID()}.jpg`;
  await env.MEDIA.put(key,result.bytes,{
    httpMetadata:{contentType:result.mimeType},
    customMetadata:{
      provider:"openai",model:result.imageModel,responseId:result.responseId||"",promptVersion:AI_PROMPT_VERSION
    }
  });

  await env.DB.prepare(
    "UPDATE posts SET graphic_key=?,ai_image_response_id=?,ai_image_prompt=?,ai_image_model=?,ai_last_error=NULL,graphic_version=COALESCE(graphic_version,0)+1,updated_at=? WHERE id=?"
  ).bind(key,result.responseId||null,result.revisedPrompt||prompt,result.imageModel,new Date().toISOString(),post.id).run();

  await logAiRun(env,{
    postId:post.id,kind:edit?"image_edit":"image_generation",model:result.imageModel,
    responseId:result.responseId,requestId:result.requestId,status:"completed",usage:result.usage,
    metadata:{orchestratorModel:result.model,revisedPrompt:result.revisedPrompt}
  });

  return result;
}

async function sendReviewEmail(
  env:GenerationEnv,clientName:string,campaignName:string,
  items:Array<{title:string;platform:string;time:string;token:string}>
){
  if(!env.RESEND_API_KEY||!env.RESEND_FROM_EMAIL||!env.REVIEW_NOTIFICATION_EMAIL||!env.REVIEW_BASE_URL)return false;
  const base=env.REVIEW_BASE_URL.replace(/\/$/,"");
  const rows=items.map(item=>`
    <div style="border:1px solid #e5e7eb;border-radius:14px;padding:18px;margin:14px 0">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#6b7280">${item.platform}</div>
      <h3 style="margin:8px 0">${item.title}</h3>
      <p style="color:#6b7280">Suggested: ${new Date(item.time).toLocaleString()}</p>
      <a href="${base}/review/${item.token}" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;padding:11px 16px;border-radius:10px;font-weight:700">Review / Edit / Approve</a>
    </div>`).join("");

  const result=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,"content-type":"application/json"},
    body:JSON.stringify({
      from:`${env.RESEND_FROM_NAME||"BrandSparQ"} <${env.RESEND_FROM_EMAIL}>`,
      to:[env.REVIEW_NOTIFICATION_EMAIL],
      subject:`Review BrandSparQ campaign: ${clientName} · ${campaignName}`,
      html:`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:28px">
        <p style="letter-spacing:.12em;font-weight:700">BRANDSPARQ</p>
        <h1>Campaign ready for review</h1><p><strong>${clientName}</strong> · ${campaignName}</p>
        <p>Review each post before it enters the official marketing calendar.</p>${rows}</div>`
    })
  });
  if(!result.ok)throw new Error(`Review email failed: ${result.status} ${(await result.text()).slice(0,300)}`);
  return true;
}

export async function runGenerationJob(env:GenerationEnv,jobId:string){
  if(!env.OPENAI_API_KEY)throw new Error("OPENAI_API_KEY is not configured.");
  const job=await env.DB.prepare(
    `SELECT g.*,c.name AS client_name,c.timezone,
      bp.voice,bp.audience,bp.primary_color,bp.secondary_color,bp.website,
      bp.tagline,bp.preferred_ctas,bp.imagery_preferences,bp.posting_rules,bp.restricted_words
      FROM generation_jobs g JOIN clients c ON c.id=g.client_id
      LEFT JOIN brand_profiles bp ON bp.client_id=g.client_id WHERE g.id=?`
  ).bind(jobId).first<any>();
  if(!job)throw new Error("Generation job not found.");

  await env.DB.prepare("UPDATE generation_jobs SET status='processing',started_at=? WHERE id=?")
    .bind(new Date().toISOString(),jobId).run();

  const assetIds:string[]=JSON.parse(job.asset_ids||"[]");
  const assets=await loadAssets(env,assetIds);
  const imageInputs=await toImageInputs(env,assets);
  const content:InputContent[]=[
    {type:"input_text",text:[
      "Create a coherent campaign of 3 to 5 social posts.",
      `Current time: ${new Date().toISOString()}`,
      `Campaign objective: ${job.objective||"Auto"}`,
      "Brand context JSON:",JSON.stringify(brandContext(job)),
      "Use only facts supplied in the context or visibly supported by the images."
    ].join("\n")},
    ...imageInputs
  ];

  const campaignCall=await createStructuredResponse<GeneratedCampaign>(env,{
    instructions:CREATIVE_DIRECTOR_INSTRUCTIONS,
    content,
    schemaName:"brandsparq_campaign",
    schema:CAMPAIGN_SCHEMA,
    reasoningEffort:"low"
  }).catch(async error=>{
    await logAiRun(env,{jobId,kind:"campaign_plan",model:env.OPENAI_TEXT_MODEL||"gpt-6.1-sol",status:"failed",error:err(error)});
    throw error;
  });

  await logAiRun(env,{
    jobId,kind:"campaign_plan",model:campaignCall.model,responseId:campaignCall.responseId,
    requestId:campaignCall.requestId,status:"completed",usage:campaignCall.usage
  });

  const generated=campaignCall.data;
  if(!generated.posts?.length)throw new Error("Generated campaign contains no posts.");

  const campaignId=crypto.randomUUID();
  const now=new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO campaigns (id,client_id,name,objective,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)"
  ).bind(campaignId,job.client_id,generated.campaignName,job.objective,now,now).run();

  const reviewItems:Array<{title:string;platform:string;time:string;token:string}>=[];
  const imageErrors:Array<{postId:string;error:string}>=[];

  for(const [index,p] of generated.posts.entries()){
    const postId=crypto.randomUUID();
    const suggested=p.suggestedPublishAt&&Date.parse(p.suggestedPublishAt)>Date.now()
      ?new Date(p.suggestedPublishAt).toISOString():fallbackSlot(index);

    await env.DB.prepare(
      `INSERT INTO posts
      (id,client_id,campaign_id,platform,status,title,headline,caption,hashtags,objective,
       suggested_publish_at,sparq_score,generation_job_id,review_requested_at,ai_caption_response_id,created_at,updated_at)
       VALUES (?,?,?,?,'awaiting_approval',?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      postId,job.client_id,campaignId,p.platform,p.headline,p.headline,p.caption,
      JSON.stringify(p.hashtags||[]),p.objective,suggested,clamp(p.sparqScore),
      jobId,now,campaignCall.responseId||null,now,now
    ).run();

    for(const assetId of assetIds){
      await env.DB.prepare("INSERT OR IGNORE INTO post_assets (post_id,asset_id,role) VALUES (?,?,'source')")
        .bind(postId,assetId).run();
    }

    const postContext={...job,id:postId,client_id:job.client_id};
    try{
      await generateGraphic(env,postContext,p,imageInputs);
    }catch(error){
      const message=err(error);imageErrors.push({postId,error:message});
      await env.DB.prepare("UPDATE posts SET ai_last_error=?,updated_at=? WHERE id=?")
        .bind(message.slice(0,1500),new Date().toISOString(),postId).run();
      await logAiRun(env,{jobId,postId,kind:"image_generation",model:env.OPENAI_IMAGE_MODEL||"gpt-image-2.5-flare",status:"failed",error:message});
    }

    const token=randomToken();
    await env.DB.prepare(
      "INSERT INTO review_tokens (id,post_id,token_hash,recipient_email,expires_at,created_at) VALUES (?,?,?,?,?,?)"
    ).bind(
      crypto.randomUUID(),postId,await reviewTokenHash(token,env),env.REVIEW_NOTIFICATION_EMAIL||"owner",
      Date.now()+7*86400000,Date.now()
    ).run();
    reviewItems.push({title:p.headline,platform:p.platform,time:suggested,token});
  }

  if(assetIds.length){
    const marks=assetIds.map(()=>"?").join(",");
    await env.DB.prepare(`UPDATE assets SET status='ready' WHERE id IN (${marks})`).bind(...assetIds).run();
  }

  const emailSent=await sendReviewEmail(env,job.client_name,generated.campaignName,reviewItems);
  await env.DB.prepare(
    "UPDATE generation_jobs SET status='completed',provider='openai',model=?,campaign_id=?,result_json=?,completed_at=? WHERE id=?"
  ).bind(
    campaignCall.model,campaignId,JSON.stringify({...generated,promptVersion:AI_PROMPT_VERSION,imageErrors}),
    new Date().toISOString(),jobId
  ).run();

  return {campaignId,postCount:generated.posts.length,imageFailures:imageErrors.length,emailSent};
}

export async function rewritePostCaptionWithAI(env:GenerationEnv,postId:string,instruction?:string){
  const post=await loadPost(env,postId);if(!post)throw new Error("Post not found.");
  const images=await toImageInputs(env,await postSourceAssets(env,postId),2);
  const result=await createStructuredResponse<{headline:string;caption:string;hashtags:string[]}>(env,{
    instructions:CAPTION_REWRITE_INSTRUCTIONS,
    content:[
      {type:"input_text",text:[
        `Platform: ${post.platform}`,`Objective: ${post.objective||""}`,
        `Current headline: ${post.headline||post.title||""}`,
        `Current caption: ${post.caption||""}`,`Current hashtags: ${post.hashtags||"[]"}`,
        `Requested change: ${instruction||"Create a fresh on-brand variation without changing verified facts."}`,
        "Brand context JSON:",JSON.stringify(brandContext(post))
      ].join("\n")},...images
    ],
    schemaName:"brandsparq_caption_rewrite",
    schema:REWRITE_SCHEMA,
    model:env.OPENAI_FAST_MODEL||"gpt-6-luna",
    reasoningEffort:"low"
  });

  await env.DB.prepare(
    "UPDATE posts SET title=?,headline=?,caption=?,hashtags=?,status='awaiting_approval',ai_caption_response_id=?,ai_last_error=NULL,updated_at=? WHERE id=?"
  ).bind(
    result.data.headline,result.data.headline,result.data.caption,JSON.stringify(result.data.hashtags||[]),
    result.responseId||null,new Date().toISOString(),postId
  ).run();

  await logAiRun(env,{postId,kind:"caption_rewrite",model:result.model,responseId:result.responseId,requestId:result.requestId,status:"completed",usage:result.usage,metadata:{instruction:instruction||null}});
  return result.data;
}

export async function editPostGraphicWithAI(env:GenerationEnv,postId:string,instruction:string){
  const post=await loadPost(env,postId);if(!post)throw new Error("Post not found.");
  if(!instruction.trim())throw new Error("An image-edit instruction is required.");

  let images:Array<{type:"input_image";image_url:string}>=[];
  let edit=false;
  if(post.graphic_key){
    const object=await env.MEDIA.get(post.graphic_key);
    if(object){
      images=[{type:"input_image",image_url:`data:${object.httpMetadata?.contentType||"image/jpeg"};base64,${toBase64(await object.arrayBuffer())}`}];
      edit=true;
    }
  }
  if(!images.length)images=await toImageInputs(env,await postSourceAssets(env,postId),3);

  const generated:GeneratedPost={
    platform:post.platform,headline:post.headline||post.title,caption:post.caption||"",
    hashtags:JSON.parse(post.hashtags||"[]"),cta:"",objective:post.objective||"",
    visualDirection:"Preserve the approved composition and brand identity.",
    suggestedPublishAt:post.suggested_publish_at||fallbackSlot(0),sparqScore:post.sparq_score||0
  };

  const result=await generateGraphic(env,post,generated,images,instruction,edit);
  return {postId,imageModel:result.imageModel,responseId:result.responseId};
}

export async function regeneratePostWithAI(env:GenerationEnv,postId:string,instruction?:string){
  await rewritePostCaptionWithAI(env,postId,instruction||"Create a distinct fresh variation while preserving all verified facts.");
  const post=await loadPost(env,postId);if(!post)throw new Error("Post not found.");
  const images=await toImageInputs(env,await postSourceAssets(env,postId),3);
  const generated:GeneratedPost={
    platform:post.platform,headline:post.headline||post.title,caption:post.caption||"",
    hashtags:JSON.parse(post.hashtags||"[]"),cta:"",objective:post.objective||"",
    visualDirection:instruction||"Create a fresh, polished on-brand visual variation using the source assets.",
    suggestedPublishAt:post.suggested_publish_at||fallbackSlot(0),sparqScore:post.sparq_score||0
  };
  const result=await generateGraphic(env,post,generated,images,instruction,false);
  return {postId,imageModel:result.imageModel,responseId:result.responseId};
}

export async function hashReviewToken(token:string,env:GenerationEnv){return reviewTokenHash(token,env);}

import { resolveDefaultSocialAccount } from "./social";
import {
  creativeProfile,
  deterministicComposition,
  evaluateCreative,
  type CreativePlatform,
} from "./creative";
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
  GENERATION_QUEUE: Queue<any>;
};

type Platform = "instagram" | "facebook" | "linkedin" | "tiktok" | "x";
type AssetRow = {
  id:string;
  r2_key:string;
  filename:string;
  content_type:string;
  size_bytes?:number|null;
};

type GeneratedPost = {
  platform: Platform;
  headline: string;
  caption: string;
  hashtags: string[];
  cta: string;
  objective: string;
  visualDirection: string;
  suggestedPublishAt: string;
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
        required:["platform","headline","caption","hashtags","cta","objective","visualDirection","suggestedPublishAt"],
        properties:{
          platform:{type:"string",enum:["instagram","facebook","linkedin","tiktok","x"]},
          headline:{type:"string"},
          caption:{type:"string"},
          hashtags:{type:"array",items:{type:"string"},maxItems:12},
          cta:{type:"string"},
          objective:{type:"string"},
          visualDirection:{type:"string"},
          suggestedPublishAt:{type:"string"}
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
function toBase64(value:ArrayBuffer|Uint8Array){
  const bytes=value instanceof Uint8Array?value:new Uint8Array(value);let binary="";const chunk=0x8000;
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
    restrictedWords:row.restricted_words||"",
    fonts:row.fonts||"",
    brandExamples:row.brand_examples||"",
    prohibitedVisualStyles:row.prohibited_visual_styles||"",
    competitorReferences:row.competitor_references||"",
    brandVocabulary:row.brand_vocabulary||"",
    hashtagPolicy:row.hashtag_policy||"",
    targetLocations:row.target_locations||"",
    platformRules:row.platform_rules||""
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

    const derivative=await env.DB.prepare(
      `SELECT r2_key,content_type,size_bytes
       FROM asset_derivatives
       WHERE asset_id=? AND kind='analysis'`
    ).bind(asset.id).first<{
      r2_key:string;
      content_type:string;
      size_bytes:number|null;
    }>();

    const source=derivative||{
      r2_key:asset.r2_key,
      content_type:asset.content_type,
      size_bytes:asset.size_bytes||null,
    };

    if((source.size_bytes||0)>8*1024*1024){
      throw new Error(
        `Asset ${asset.filename} is too large for AI analysis. Re-upload it through BrandSparQ so an analysis derivative can be created.`
      );
    }

    const object=await env.MEDIA.get(source.r2_key);
    if(!object)throw new Error(`Source image is missing from storage: ${asset.filename}`);

    out.push({
      type:"input_image",
      image_url:`data:${source.content_type};base64,${toBase64(await object.arrayBuffer())}`,
    });
  }
  return out;
}

async function brandLogoInput(
  env:GenerationEnv,
  logoAssetId?:string|null
):Promise<{type:"input_image";image_url:string}|null>{
  if(!logoAssetId)return null;
  const asset=await env.DB.prepare(
    "SELECT r2_key,content_type,size_bytes FROM assets WHERE id=?"
  ).bind(logoAssetId).first<{
    r2_key:string;
    content_type:string;
    size_bytes:number|null;
  }>();
  if(!asset||!asset.content_type?.startsWith("image/"))return null;
  if((asset.size_bytes||0)>8*1024*1024)return null;
  const object=await env.MEDIA.get(asset.r2_key);
  if(!object)return null;
  return {
    type:"input_image",
    image_url:`data:${asset.content_type};base64,${toBase64(await object.arrayBuffer())}`,
  };
}

async function loadPost(env:GenerationEnv,postId:string){
  return env.DB.prepare(
    `SELECT p.*,c.name AS client_name,c.timezone,
      bp.voice,bp.audience,bp.primary_color,bp.secondary_color,bp.website,
      bp.tagline,bp.preferred_ctas,bp.imagery_preferences,bp.posting_rules,bp.restricted_words,
      bp.fonts,bp.brand_examples,bp.prohibited_visual_styles,bp.competitor_references,
      bp.brand_vocabulary,bp.hashtag_policy,bp.target_locations,bp.platform_rules,
      bp.logo_asset_id,bp.alternate_logo_asset_id
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
  const profile=creativeProfile(generated.platform as CreativePlatform);
  const composition=deterministicComposition({
    platform:generated.platform as CreativePlatform,
    headline:generated.headline,
    cta:generated.cta,
    primaryColor:post.primary_color,
    secondaryColor:post.secondary_color,
    logoAssetId:post.logo_asset_id,
  });

  const prompt=[
    `Create a polished ${profile.aspectRatio} social-media graphic.`,
    `Target canvas: ${profile.width}x${profile.height}.`,
    `Platform: ${generated.platform}`,
    `Campaign objective: ${generated.objective}`,
    `Headline: ${generated.headline}`,
    `CTA: ${generated.cta}`,
    `Visual direction: ${generated.visualDirection}`,
    instruction?`Requested change: ${instruction}`:"",
    "Brand context JSON:",
    JSON.stringify(brandContext(post)),
    "Deterministic composition contract JSON:",
    JSON.stringify(composition),
    "Use supplied images as source/reference material where appropriate.",
    "Respect the composition safe areas and visual hierarchy.",
    "Do not invent or mutate a logo. If a logo is supplied, reserve its specified location.",
    "Do not place the full caption inside the graphic."
  ].filter(Boolean).join("\n");

  const logoInput=await brandLogoInput(env,post.logo_asset_id);
  const visualInputs=logoInput?[...images,logoInput]:images;

  const result=await createImageResponse(env,{
    instructions:IMAGE_DIRECTOR_INSTRUCTIONS,
    prompt,
    images:visualInputs,
    action:edit?"edit":"auto",
    imageModel:edit
      ?(env.OPENAI_IMAGE_EDIT_MODEL||"gpt-image-2.5-sunburst")
      :(env.OPENAI_IMAGE_MODEL||"gpt-image-2.5-flare"),
    size:profile.imageSize,
  });

  const existingVariant=await env.DB.prepare(
    "SELECT id FROM creative_variants WHERE post_id=? AND variant_key=?"
  ).bind(post.id,profile.variantKey).first<{id:string}>();
  const variantId=existingVariant?.id||crypto.randomUUID();
  const key=`generated/${post.client_id}/${post.id}/${profile.variantKey}/${crypto.randomUUID()}.jpg`;
  await env.MEDIA.put(key,result.bytes,{
    httpMetadata:{contentType:result.mimeType},
    customMetadata:{
      provider:"openai",
      model:result.imageModel,
      responseId:result.responseId||"",
      promptVersion:AI_PROMPT_VERSION,
      variantKey:profile.variantKey,
      aspectRatio:profile.aspectRatio,
    }
  });

  const imageUrl=`data:${result.mimeType};base64,${toBase64(result.bytes)}`;

  const scoreResult=await evaluateCreative(env,{
    platform:generated.platform as CreativePlatform,
    headline:generated.headline,
    caption:generated.caption,
    hashtags:generated.hashtags||[],
    objective:generated.objective,
    brandContext:brandContext(post),
    composition,
    imageUrl,
  });

  const score=scoreResult.data;
  const now=new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO creative_variants
       (id,post_id,platform,variant_key,aspect_ratio,width,height,r2_key,content_type,
        is_primary,composition_json,model,response_id)
       VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)
       ON CONFLICT(post_id,variant_key) DO UPDATE SET
         aspect_ratio=excluded.aspect_ratio,
         width=excluded.width,
         height=excluded.height,
         r2_key=excluded.r2_key,
         content_type=excluded.content_type,
         is_primary=1,
         composition_json=excluded.composition_json,
         model=excluded.model,
         response_id=excluded.response_id,
         created_at=CURRENT_TIMESTAMP`
    ).bind(
      variantId,
      post.id,
      generated.platform,
      profile.variantKey,
      profile.aspectRatio,
      profile.width,
      profile.height,
      key,
      result.mimeType,
      JSON.stringify(composition),
      result.imageModel,
      result.responseId||null
    ),
    env.DB.prepare(
      `INSERT INTO sparq_scores
       (post_id,overall,brand_match,readability,platform_fit,cta_strength,
        composition,caption_quality,compliance,rationale,model,response_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(post_id) DO UPDATE SET
         overall=excluded.overall,
         brand_match=excluded.brand_match,
         readability=excluded.readability,
         platform_fit=excluded.platform_fit,
         cta_strength=excluded.cta_strength,
         composition=excluded.composition,
         caption_quality=excluded.caption_quality,
         compliance=excluded.compliance,
         rationale=excluded.rationale,
         model=excluded.model,
         response_id=excluded.response_id,
         updated_at=CURRENT_TIMESTAMP`
    ).bind(
      post.id,
      score.overall,
      score.brandMatch,
      score.readability,
      score.platformFit,
      score.ctaStrength,
      score.composition,
      score.captionQuality,
      score.compliance,
      score.rationale,
      scoreResult.model,
      scoreResult.responseId||null
    ),
    env.DB.prepare(
      `UPDATE posts SET
       graphic_key=?,
       primary_variant_id=?,
       creative_composition=?,
       sparq_score=?,
       ai_image_response_id=?,
       ai_image_prompt=?,
       ai_image_model=?,
       ai_last_error=NULL,
       graphic_version=COALESCE(graphic_version,0)+1,
       updated_at=?
       WHERE id=?`
    ).bind(
      key,
      variantId,
      JSON.stringify(composition),
      score.overall,
      result.responseId||null,
      result.revisedPrompt||prompt,
      result.imageModel,
      now,
      post.id
    ),
  ]);

  await logAiRun(env,{
    postId:post.id,
    kind:edit?"image_edit":"image_generation",
    model:result.imageModel,
    responseId:result.responseId,
    requestId:result.requestId,
    status:"completed",
    usage:result.usage,
    metadata:{
      orchestratorModel:result.model,
      revisedPrompt:result.revisedPrompt,
      variantKey:profile.variantKey,
      aspectRatio:profile.aspectRatio,
    }
  });

  await logAiRun(env,{
    postId:post.id,
    kind:"sparq_score",
    model:scoreResult.model,
    responseId:scoreResult.responseId,
    requestId:scoreResult.requestId,
    status:"completed",
    usage:scoreResult.usage,
    metadata:score,
  });

  return {
    ...result,
    variantId,
    profile,
    composition,
    sparqScore:score,
  };
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

  let job=await env.DB.prepare(
    `SELECT g.*,c.name AS client_name,c.timezone,
      bp.voice,bp.audience,bp.primary_color,bp.secondary_color,bp.website,
      bp.tagline,bp.preferred_ctas,bp.imagery_preferences,bp.posting_rules,bp.restricted_words,
      bp.fonts,bp.brand_examples,bp.prohibited_visual_styles,bp.competitor_references,
      bp.brand_vocabulary,bp.hashtag_policy,bp.target_locations,bp.platform_rules,
      bp.logo_asset_id,bp.alternate_logo_asset_id
      FROM generation_jobs g JOIN clients c ON c.id=g.client_id
      LEFT JOIN brand_profiles bp ON bp.client_id=g.client_id WHERE g.id=?`
  ).bind(jobId).first<any>();
  if(!job)throw new Error("Generation job not found.");

  if(job.status==="completed"&&job.campaign_id){
    const count=await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM posts WHERE generation_job_id=?"
    ).bind(jobId).first<{count:number}>();
    return {
      campaignId:job.campaign_id,
      postCount:Number(count?.count||0),
      imageFailures:0,
      emailSent:!!job.review_email_sent_at,
      resumed:true
    };
  }

  const startedAt=job.started_at||new Date().toISOString();
  await env.DB.prepare(
    `UPDATE generation_jobs SET
       status='processing',
       started_at=COALESCE(started_at,?),
       stage_updated_at=?,
       error_message=NULL
     WHERE id=?`
  ).bind(startedAt,new Date().toISOString(),jobId).run();

  const assetIds:string[]=JSON.parse(job.asset_ids||"[]");
  const assets=await loadAssets(env,assetIds);
  const imageInputs=await toImageInputs(env,assets);

  let generated:GeneratedCampaign;
  let campaignModel:string=job.model||env.OPENAI_TEXT_MODEL||"gpt-6.1-sol";
  let campaignResponseId:string|null=null;

  if(job.plan_json){
    generated=JSON.parse(job.plan_json) as GeneratedCampaign;
  }else{
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
      await logAiRun(env,{
        jobId,
        kind:"campaign_plan",
        model:env.OPENAI_TEXT_MODEL||"gpt-6.1-sol",
        status:"failed",
        error:err(error)
      });
      throw error;
    });

    generated=campaignCall.data;
    campaignModel=campaignCall.model;
    campaignResponseId=campaignCall.responseId||null;

    if(!generated.posts?.length)throw new Error("Generated campaign contains no posts.");

    await logAiRun(env,{
      jobId,
      kind:"campaign_plan",
      model:campaignCall.model,
      responseId:campaignCall.responseId,
      requestId:campaignCall.requestId,
      status:"completed",
      usage:campaignCall.usage
    });

    await env.DB.prepare(
      `UPDATE generation_jobs SET
       stage='planned',
       plan_json=?,
       provider='openai',
       model=?,
       stage_updated_at=?
       WHERE id=?`
    ).bind(
      JSON.stringify(generated),
      campaignCall.model,
      new Date().toISOString(),
      jobId
    ).run();
  }

  if(!generated.posts?.length)throw new Error("Generated campaign contains no posts.");

  let campaignId:string|undefined=job.campaign_id||undefined;
  if(!campaignId){
    campaignId=crypto.randomUUID();
    const now=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO campaigns (id,client_id,name,objective,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)"
      ).bind(campaignId,job.client_id,generated.campaignName,job.objective,now,now),
      env.DB.prepare(
        `UPDATE generation_jobs SET
         campaign_id=?,
         stage='campaign_created',
         stage_updated_at=?
         WHERE id=?`
      ).bind(campaignId,now,jobId),
    ]);
  }

  const savedPostIds:string[]=job.post_ids
    ? JSON.parse(job.post_ids)
    : [];

  const existingPosts=savedPostIds.length
    ? await env.DB.prepare(
        `SELECT id,platform,title,headline,caption,suggested_publish_at,graphic_key
         FROM posts
         WHERE generation_job_id=?`
      ).bind(jobId).all<any>()
    : await env.DB.prepare(
        `SELECT id,platform,title,headline,caption,suggested_publish_at,graphic_key
         FROM posts
         WHERE generation_job_id=?
         ORDER BY rowid ASC`
      ).bind(jobId).all<any>();

  const existingById=new Map(
    existingPosts.results.map((row:any)=>[row.id,row])
  );

  const postIds:string[]=[];
  const graphicJobIds:string[]=[];
  const now=new Date().toISOString();

  for(const [index,p] of generated.posts.entries()){
    const savedId=savedPostIds[index];
    let existing=savedId
      ? existingById.get(savedId)
      : existingPosts.results[index];
    let postId:string;

    if(existing){
      postId=existing.id;
    }else{
      postId=crypto.randomUUID();
      const suggested=p.suggestedPublishAt&&Date.parse(p.suggestedPublishAt)>Date.now()
        ?new Date(p.suggestedPublishAt).toISOString()
        :fallbackSlot(index);

      const defaultSocial=await resolveDefaultSocialAccount(
        env,
        job.client_id,
        p.platform
      );

      await env.DB.prepare(
        `INSERT INTO posts
        (id,client_id,campaign_id,platform,status,title,headline,caption,hashtags,objective,
         suggested_publish_at,sparq_score,generation_job_id,review_requested_at,
         ai_caption_response_id,social_account_id,created_at,updated_at)
         VALUES (?,?,?,?,'review_ready',?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        postId,
        job.client_id,
        campaignId,
        p.platform,
        p.headline,
        p.headline,
        p.caption,
        JSON.stringify(p.hashtags||[]),
        p.objective,
        suggested,
        null,
        jobId,
        now,
        campaignResponseId,
        defaultSocial?.id||null,
        now,
        now
      ).run();

      existing={
        id:postId,
        platform:p.platform,
        title:p.headline,
        headline:p.headline,
        caption:p.caption,
        suggested_publish_at:suggested,
        graphic_key:null
      };
    }

    postIds.push(postId);

    for(const assetId of assetIds){
      await env.DB.prepare(
        "INSERT OR IGNORE INTO post_assets (post_id,asset_id,role) VALUES (?,?,'source')"
      ).bind(postId,assetId).run();
    }

    const persisted=await env.DB.prepare(
      "SELECT graphic_key FROM posts WHERE id=?"
    ).bind(postId).first<{graphic_key:string|null}>();

    const composition=deterministicComposition({
      platform:p.platform as CreativePlatform,
      headline:p.headline,
      cta:p.cta,
      primaryColor:job.primary_color,
      secondaryColor:job.secondary_color,
      logoAssetId:job.logo_asset_id,
    });

    await env.DB.prepare(
      "UPDATE posts SET creative_composition=?,updated_at=? WHERE id=?"
    ).bind(
      JSON.stringify({
        ...composition,
        cta:p.cta,
        visualDirection:p.visualDirection,
      }),
      new Date().toISOString(),
      postId
    ).run();

    let graphicJob=await env.DB.prepare(
      "SELECT id,status FROM graphic_jobs WHERE post_id=?"
    ).bind(postId).first<{id:string;status:string}>();

    if(!graphicJob){
      const graphicJobId=crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO graphic_jobs
         (id,generation_job_id,post_id,status,created_at,updated_at)
         VALUES (?,?,?,'queued',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
      ).bind(graphicJobId,jobId,postId).run();
      graphicJob={id:graphicJobId,status:"queued"};
    }

    if(persisted?.graphic_key&&graphicJob.status!=="completed"){
      await env.DB.prepare(
        `UPDATE graphic_jobs SET
         status='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
         WHERE id=?`
      ).bind(graphicJob.id).run();
      graphicJob.status="completed";
    }

    if(graphicJob.status!=="completed"){
      graphicJobIds.push(graphicJob.id);
    }

    await env.DB.prepare(
      `UPDATE generation_jobs SET
       post_ids=?,
       stage='posts_created',
       stage_updated_at=?
       WHERE id=?`
    ).bind(
      JSON.stringify(postIds),
      new Date().toISOString(),
      jobId
    ).run();
  }

  if(assetIds.length){
    const marks=assetIds.map(()=>"?").join(",");
    await env.DB.prepare(
      `UPDATE assets SET status='ready' WHERE id IN (${marks})`
    ).bind(...assetIds).run();
  }

  for(const graphicJobId of graphicJobIds){
    await env.GENERATION_QUEUE.send({
      kind:"graphic",
      graphicJobId,
    });
  }

  await env.DB.prepare(
    `UPDATE generation_jobs SET
     status=?,
     stage=?,
     provider='openai',
     model=?,
     campaign_id=?,
     post_ids=?,
     result_json=?,
     error_message=NULL,
     stage_updated_at=?
     WHERE id=?`
  ).bind(
    graphicJobIds.length?"rendering":"processing",
    graphicJobIds.length?"graphics_queued":"posts_created",
    campaignModel,
    campaignId,
    JSON.stringify(postIds),
    JSON.stringify({
      ...generated,
      promptVersion:AI_PROMPT_VERSION,
    }),
    new Date().toISOString(),
    jobId
  ).run();

  if(!graphicJobIds.length){
    await finalizeGenerationReview(env,jobId);
  }

  return {
    campaignId,
    postCount:postIds.length,
    graphicJobsQueued:graphicJobIds.length,
    resumed:!!job.plan_json||!!job.campaign_id||existingPosts.results.length>0
  };
}

async function generatedPostForGraphicJob(
  env:GenerationEnv,
  generationJobId:string,
  postId:string
){
  const generation=await env.DB.prepare(
    "SELECT plan_json,post_ids FROM generation_jobs WHERE id=?"
  ).bind(generationJobId).first<{plan_json:string|null;post_ids:string|null}>();
  if(!generation?.plan_json)throw new Error("Generation plan is missing.");

  const plan=JSON.parse(generation.plan_json) as GeneratedCampaign;
  const postIds:string[]=generation.post_ids?JSON.parse(generation.post_ids):[];
  const index=postIds.indexOf(postId);
  if(index<0||!plan.posts[index])throw new Error("Graphic job post is not present in the generation plan.");
  return plan.posts[index];
}

export async function runGraphicJob(env:GenerationEnv,graphicJobId:string){
  const graphicJob=await env.DB.prepare(
    `SELECT gj.*,p.client_id,p.graphic_key
     FROM graphic_jobs gj
     JOIN posts p ON p.id=gj.post_id
     WHERE gj.id=?`
  ).bind(graphicJobId).first<any>();
  if(!graphicJob)throw new Error("Graphic job not found.");
  if(graphicJob.status==="completed")return {completed:true,resumed:true};

  const claimed=await env.DB.prepare(
    `UPDATE graphic_jobs SET
     status='processing',
     attempt_count=attempt_count+1,
     claimed_at=CURRENT_TIMESTAMP,
     updated_at=CURRENT_TIMESTAMP
     WHERE id=? AND status IN ('queued','retrying')`
  ).bind(graphicJobId).run();

  if(!claimed.meta.changes){
    return {completed:graphicJob.status==="completed",resumed:true};
  }

  const post=await loadPost(env,graphicJob.post_id);
  if(!post)throw new Error("Post not found for graphic job.");

  if(!post.graphic_key){
    const generated=await generatedPostForGraphicJob(
      env,
      graphicJob.generation_job_id,
      graphicJob.post_id
    );
    const images=await toImageInputs(
      env,
      await postSourceAssets(env,graphicJob.post_id),
      3
    );
    await generateGraphic(env,post,generated,images);
  }

  await env.DB.prepare(
    `UPDATE graphic_jobs SET
     status='completed',
     last_error=NULL,
     completed_at=CURRENT_TIMESTAMP,
     updated_at=CURRENT_TIMESTAMP
     WHERE id=?`
  ).bind(graphicJobId).run();

  await finalizeGenerationReview(env,graphicJob.generation_job_id);
  return {completed:true,resumed:false};
}

export async function markGraphicJobFailure(
  env:GenerationEnv,
  graphicJobId:string,
  errorMessage:string,
  terminal:boolean
){
  await env.DB.prepare(
    `UPDATE graphic_jobs SET
     status=?,
     last_error=?,
     claimed_at=NULL,
     completed_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END,
     updated_at=CURRENT_TIMESTAMP
     WHERE id=?`
  ).bind(
    terminal?"failed":"retrying",
    errorMessage.slice(0,1500),
    terminal?1:0,
    graphicJobId
  ).run();

  if(terminal){
    const job=await env.DB.prepare(
      "SELECT generation_job_id,post_id FROM graphic_jobs WHERE id=?"
    ).bind(graphicJobId).first<{generation_job_id:string;post_id:string}>();
    if(job){
      await env.DB.prepare(
        `UPDATE posts SET
         status='edit_requested',
         ai_last_error=?,
         updated_at=CURRENT_TIMESTAMP
         WHERE id=?`
      ).bind(errorMessage.slice(0,1500),job.post_id).run();
      await finalizeGenerationReview(env,job.generation_job_id);
    }
  }
}

export async function finalizeGenerationReview(env:GenerationEnv,jobId:string){
  const pending=await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM graphic_jobs
     WHERE generation_job_id=? AND status IN ('queued','processing','retrying')`
  ).bind(jobId).first<{count:number}>();
  if(Number(pending?.count||0)>0)return {ready:false};

  const job=await env.DB.prepare(
    `SELECT g.*,c.name AS client_name,campaigns.name AS campaign_name
     FROM generation_jobs g
     JOIN clients c ON c.id=g.client_id
     LEFT JOIN campaigns ON campaigns.id=g.campaign_id
     WHERE g.id=?`
  ).bind(jobId).first<any>();
  if(!job)throw new Error("Generation job not found.");

  const posts=await env.DB.prepare(
    `SELECT id,title,platform,suggested_publish_at
     FROM posts WHERE generation_job_id=? ORDER BY rowid ASC`
  ).bind(jobId).all<any>();

  let emailSent=!!job.review_email_sent_at;
  if(!emailSent&&posts.results.length){
    const reviewItems:Array<{title:string;platform:string;time:string;token:string}>=[];
    for(const [index,post] of posts.results.entries()){
      const token=randomToken();
      await env.DB.prepare(
        "UPDATE review_tokens SET used_at=? WHERE post_id=? AND used_at IS NULL"
      ).bind(Date.now(),post.id).run();
      await env.DB.prepare(
        `INSERT INTO review_tokens
         (id,post_id,token_hash,recipient_email,expires_at,created_at)
         VALUES (?,?,?,?,?,?)`
      ).bind(
        crypto.randomUUID(),
        post.id,
        await reviewTokenHash(token,env),
        env.REVIEW_NOTIFICATION_EMAIL||"owner",
        Date.now()+7*86400000,
        Date.now()
      ).run();
      reviewItems.push({
        title:post.title,
        platform:post.platform,
        time:post.suggested_publish_at||fallbackSlot(index),
        token,
      });
    }

    emailSent=await sendReviewEmail(
      env,
      job.client_name,
      job.campaign_name||"Campaign",
      reviewItems
    );
  }

  const failed=await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM graphic_jobs
     WHERE generation_job_id=? AND status='failed'`
  ).bind(jobId).first<{count:number}>();

  const now=new Date().toISOString();

  await env.DB.prepare(
    `UPDATE posts SET
     status='awaiting_approval',
     review_requested_at=COALESCE(review_requested_at,?),
     updated_at=?
     WHERE generation_job_id=? AND status='review_ready'`
  ).bind(now,now,jobId).run();

  await env.DB.prepare(
    `UPDATE generation_jobs SET
     status='completed',
     stage=?,
     review_email_sent_at=CASE WHEN ? THEN COALESCE(review_email_sent_at,?) ELSE review_email_sent_at END,
     completed_at=?,
     stage_updated_at=?,
     error_message=CASE WHEN ? > 0 THEN 'One or more graphics failed and require regeneration.' ELSE NULL END
     WHERE id=?`
  ).bind(
    Number(failed?.count||0)>0?"completed_with_graphic_errors":"completed",
    emailSent?1:0,
    emailSent?now:null,
    now,
    now,
    Number(failed?.count||0),
    jobId
  ).run();

  return {
    ready:true,
    emailSent,
    graphicFailures:Number(failed?.count||0),
  };
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
    suggestedPublishAt:post.suggested_publish_at||fallbackSlot(0)
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
    suggestedPublishAt:post.suggested_publish_at||fallbackSlot(0)
  };
  const result=await generateGraphic(env,post,generated,images,instruction,false);
  return {postId,imageModel:result.imageModel,responseId:result.responseId};
}

export async function hashReviewToken(token:string,env:GenerationEnv){return reviewTokenHash(token,env);}

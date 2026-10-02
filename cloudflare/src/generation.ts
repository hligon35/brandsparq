export type GenerationEnv = {
  DB: D1Database;
  MEDIA: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
  AUTH_PEPPER?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_FROM_NAME?: string;
  REVIEW_NOTIFICATION_EMAIL?: string;
  REVIEW_BASE_URL?: string;
};

type GeneratedPost = {
  platform: "instagram" | "facebook" | "linkedin" | "tiktok" | "x";
  headline: string;
  caption: string;
  hashtags: string[];
  objective: string;
  suggestedPublishAt: string;
  sparqScore: number;
};

type GeneratedCampaign = {
  campaignName: string;
  summary: string;
  posts: GeneratedPost[];
};

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return bytesToHex(new Uint8Array(digest));
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

async function reviewTokenHash(token: string, env: GenerationEnv) {
  return sha256(`${env.AUTH_PEPPER || ""}:review:${token}`);
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function extractOutputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

function stripJsonFence(value: string) {
  return value
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/, "");
}

function fallbackSlot(index: number) {
  const date = new Date(Date.now() + (index + 1) * 24 * 60 * 60 * 1000);
  date.setUTCHours([14, 18, 22][index % 3], 0, 0, 0);
  return date.toISOString();
}

async function sendReviewEmail(
  env: GenerationEnv,
  clientName: string,
  campaignName: string,
  items: Array<{ title: string; platform: string; time: string; token: string }>
) {
  if (
    !env.RESEND_API_KEY ||
    !env.RESEND_FROM_EMAIL ||
    !env.REVIEW_NOTIFICATION_EMAIL ||
    !env.REVIEW_BASE_URL
  ) {
    return false;
  }

  const base = env.REVIEW_BASE_URL.replace(/\/$/, "");
  const rows = items
    .map(
      (item) => `
        <div style="border:1px solid #e5e7eb;border-radius:14px;padding:18px;margin:14px 0">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#6b7280">${item.platform}</div>
          <h3 style="margin:8px 0">${item.title}</h3>
          <p style="color:#6b7280">Suggested: ${new Date(item.time).toLocaleString()}</p>
          <a href="${base}/review/${item.token}" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;padding:11px 16px;border-radius:10px;font-weight:700">Review / Edit / Approve</a>
        </div>
      `
    )
    .join("");

  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `${env.RESEND_FROM_NAME || "BrandSparQ"} <${env.RESEND_FROM_EMAIL}>`,
      to: [env.REVIEW_NOTIFICATION_EMAIL],
      subject: `Review BrandSparQ campaign: ${clientName} · ${campaignName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:28px">
          <p style="letter-spacing:.12em;font-weight:700">BRANDSPARQ</p>
          <h1>Campaign ready for review</h1>
          <p><strong>${clientName}</strong> · ${campaignName}</p>
          <p>Review each post before it enters the official marketing calendar.</p>
          ${rows}
        </div>
      `,
    }),
  });

  if (!result.ok) {
    throw new Error(`Review email failed: ${result.status} ${(await result.text()).slice(0, 300)}`);
  }
  return true;
}

export async function runGenerationJob(env: GenerationEnv, jobId: string) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const job = await env.DB.prepare(
    `SELECT g.*, c.name AS client_name, c.timezone,
       bp.voice, bp.audience, bp.primary_color, bp.secondary_color, bp.website,
       bp.tagline, bp.preferred_ctas, bp.imagery_preferences, bp.posting_rules,
       bp.restricted_words
     FROM generation_jobs g
     JOIN clients c ON c.id = g.client_id
     LEFT JOIN brand_profiles bp ON bp.client_id = g.client_id
     WHERE g.id = ?`
  )
    .bind(jobId)
    .first<any>();

  if (!job) throw new Error("Generation job not found.");

  await env.DB.prepare(
    "UPDATE generation_jobs SET status = 'processing', started_at = ? WHERE id = ?"
  )
    .bind(new Date().toISOString(), jobId)
    .run();

  const assetIds: string[] = JSON.parse(job.asset_ids || "[]");
  const placeholders = assetIds.map(() => "?").join(",");
  const assetRows = assetIds.length
    ? await env.DB.prepare(
        `SELECT id, r2_key, filename, content_type, size_bytes
         FROM assets WHERE id IN (${placeholders})`
      )
        .bind(...assetIds)
        .all<any>()
    : { results: [] as any[] };

  const prompt = `
You are BrandSparQ, an AI marketing production system.
Create a coherent social campaign from the supplied brand profile and source images.

Client: ${job.client_name}
Timezone: ${job.timezone || "America/Indiana/Indianapolis"}
Objective: ${job.objective || "Auto"}
Brand voice: ${job.voice || "clear, useful, confident"}
Audience: ${job.audience || "general audience"}
Tagline: ${job.tagline || ""}
Website: ${job.website || ""}
Preferred CTAs: ${job.preferred_ctas || ""}
Imagery preferences: ${job.imagery_preferences || ""}
Posting rules: ${job.posting_rules || ""}
Restricted words: ${job.restricted_words || ""}
Current time: ${new Date().toISOString()}

Generate 3-5 posts. Vary purpose across promotion, awareness, education, engagement, or announcement as appropriate.
Write platform-native captions. Use only facts visible in the images or explicitly supplied above.
Do not invent dates, prices, offers, names, statistics, or claims.
Suggested publishing times must be valid future ISO-8601 timestamps.
SparQ Score is an integer 0-100 reflecting brand match, copy quality, readability, platform fit, CTA strength, and composition opportunity.
`.trim();

  const content: any[] = [{ type: "input_text", text: prompt }];

  for (const asset of assetRows.results.slice(0, 3)) {
    if ((asset.size_bytes || 0) > 4 * 1024 * 1024) continue;
    const object = await env.MEDIA.get(asset.r2_key);
    if (!object) continue;
    const buffer = await object.arrayBuffer();
    content.push({
      type: "input_image",
      image_url: `data:${asset.content_type};base64,${toBase64(buffer)}`,
    });
  }

  const model = env.OPENAI_TEXT_MODEL || "gpt-5.6-sol";
  const aiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "brandsparq_campaign",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["campaignName", "summary", "posts"],
            properties: {
              campaignName: { type: "string" },
              summary: { type: "string" },
              posts: {
                type: "array",
                minItems: 3,
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "platform",
                    "headline",
                    "caption",
                    "hashtags",
                    "objective",
                    "suggestedPublishAt",
                    "sparqScore"
                  ],
                  properties: {
                    platform: {
                      type: "string",
                      enum: ["instagram", "facebook", "linkedin", "tiktok", "x"]
                    },
                    headline: { type: "string" },
                    caption: { type: "string" },
                    hashtags: {
                      type: "array",
                      items: { type: "string" },
                      maxItems: 12
                    },
                    objective: { type: "string" },
                    suggestedPublishAt: { type: "string" },
                    sparqScore: { type: "integer", minimum: 0, maximum: 100 }
                  }
                }
              }
            }
          }
        }
      }
    }),
  });

  if (!aiResponse.ok) {
    throw new Error(
      `OpenAI generation failed: ${aiResponse.status} ${(await aiResponse.text()).slice(0, 500)}`
    );
  }

  const aiPayload = await aiResponse.json<any>();
  const output = extractOutputText(aiPayload);
  if (!output) throw new Error("OpenAI returned no campaign content.");

  const generated = JSON.parse(stripJsonFence(output)) as GeneratedCampaign;
  if (!generated.posts?.length) throw new Error("Generated campaign contains no posts.");

  const campaignId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO campaigns
     (id, client_id, name, objective, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  )
    .bind(campaignId, job.client_id, generated.campaignName, job.objective, now, now)
    .run();

  const reviewItems: Array<{
    title: string;
    platform: string;
    time: string;
    token: string;
  }> = [];

  for (const [index, generatedPost] of generated.posts.entries()) {
    const postId = crypto.randomUUID();
    const suggested =
      generatedPost.suggestedPublishAt &&
      Date.parse(generatedPost.suggestedPublishAt) > Date.now()
        ? new Date(generatedPost.suggestedPublishAt).toISOString()
        : fallbackSlot(index);

    await env.DB.prepare(
      `INSERT INTO posts
       (id, client_id, campaign_id, platform, status, title, headline, caption,
        hashtags, objective, suggested_publish_at, sparq_score, generation_job_id,
        review_requested_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'awaiting_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        postId,
        job.client_id,
        campaignId,
        generatedPost.platform,
        generatedPost.headline,
        generatedPost.headline,
        generatedPost.caption,
        JSON.stringify(generatedPost.hashtags || []),
        generatedPost.objective,
        suggested,
        Math.max(0, Math.min(100, Math.round(generatedPost.sparqScore || 0))),
        jobId,
        now,
        now,
        now
      )
      .run();

    for (const assetId of assetIds) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO post_assets (post_id, asset_id, role) VALUES (?, ?, 'source')"
      )
        .bind(postId, assetId)
        .run();
    }

    const token = randomToken();
    await env.DB.prepare(
      `INSERT INTO review_tokens
       (id, post_id, token_hash, recipient_email, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        postId,
        await reviewTokenHash(token, env),
        env.REVIEW_NOTIFICATION_EMAIL || "owner",
        Date.now() + 7 * 24 * 60 * 60 * 1000,
        Date.now()
      )
      .run();

    reviewItems.push({
      title: generatedPost.headline,
      platform: generatedPost.platform,
      time: suggested,
      token,
    });
  }

  const emailSent = await sendReviewEmail(
    env,
    job.client_name,
    generated.campaignName,
    reviewItems
  );

  await env.DB.prepare(
    `UPDATE generation_jobs SET
       status = 'completed',
       provider = 'openai',
       model = ?,
       campaign_id = ?,
       result_json = ?,
       completed_at = ?
     WHERE id = ?`
  )
    .bind(model, campaignId, JSON.stringify(generated), new Date().toISOString(), jobId)
    .run();

  return {
    campaignId,
    postCount: generated.posts.length,
    emailSent,
  };
}

export async function hashReviewToken(token: string, env: GenerationEnv) {
  return reviewTokenHash(token, env);
}

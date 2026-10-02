import { getSessionUser, handleAuthRoute } from "./auth";
import { hashReviewToken, runGenerationJob } from "./generation";

interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  PUBLISH_QUEUE: Queue<JobMessage>;
  GENERATION_QUEUE: Queue<JobMessage>;
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
  AUTH_PEPPER?: string;
  AUTH_ALLOWED_EMAILS?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_FROM_NAME?: string;
  REVIEW_NOTIFICATION_EMAIL?: string;
  REVIEW_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
}

type PublishMessage = {
  kind: "publish";
  postId: string;
  idempotencyKey: string;
};

type GenerationMessage = {
  kind: "generate";
  jobId: string;
};

type JobMessage = PublishMessage | GenerationMessage;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function cors(request: Request, env: Env) {
  const origin = request.headers.get("origin");
  const configured = new Set(
    (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const isLocal = !!origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  const requestOrigin = new URL(request.url).origin;
  const sameOrigin = !!origin && origin === requestOrigin;
  const allowed = !origin || sameOrigin || configured.has(origin) || isLocal;
  return {
    allowed,
    headers: {
      "access-control-allow-origin": origin && allowed ? origin : "",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,x-client-id,x-file-name",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  };
}

function response(request: Request, env: Env, body: unknown, init: ResponseInit = {}) {
  const policy = cors(request, env);
  return Response.json(body, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...policy.headers,
      ...init.headers,
    },
  });
}

function postSelect(where = "") {
  return `SELECT
    p.*,
    c.name AS client_name,
    COALESCE(bp.primary_color, '#A56CFF') AS client_color,
    CASE WHEN p.graphic_key IS NOT NULL THEN '/v1/media/' || p.graphic_key ELSE NULL END AS image_url
    FROM posts p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN brand_profiles bp ON bp.client_id = p.client_id
    ${where}`;
}

async function getPost(env: Env, postId: string) {
  return env.DB.prepare(postSelect("WHERE p.id = ?")).bind(postId).first();
}

async function audit(env: Env, postId: string, action: string, metadata?: unknown) {
  await env.DB.prepare(
    "INSERT INTO audit_logs (id, post_id, actor_id, action, metadata) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      crypto.randomUUID(),
      postId,
      "system",
      action,
      metadata ? JSON.stringify(metadata) : null
    )
    .run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const policy = cors(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: policy.allowed ? 204 : 403,
        headers: policy.headers,
      });
    }
    if (!policy.allowed) return response(request, env, { error: "Origin not allowed" }, { status: 403 });

    if (url.pathname === "/health") {
      return response(request, env, { ok: true, service: "brandsparq-api" });
    }

    const publicReviewMatch = url.pathname.match(/^\/v1\/public\/review\/([^/]+)$/);
    if (publicReviewMatch && request.method === "GET") {
      const tokenHash = await hashReviewToken(publicReviewMatch[1], env);
      const row = await env.DB.prepare(
        `SELECT rt.id AS review_token_id, rt.expires_at, rt.used_at,
                p.*, c.name AS client_name,
                COALESCE(bp.primary_color, '#A56CFF') AS client_color
         FROM review_tokens rt
         JOIN posts p ON p.id = rt.post_id
         JOIN clients c ON c.id = p.client_id
         LEFT JOIN brand_profiles bp ON bp.client_id = p.client_id
         WHERE rt.token_hash = ?`
      ).bind(tokenHash).first<any>();

      if (!row || row.expires_at <= Date.now()) {
        return response(request, env, { error: "This review link is invalid or expired." }, { status: 404 });
      }
      return response(request, env, { data: row });
    }

    const publicApproveMatch = url.pathname.match(/^\/v1\/public\/review\/([^/]+)\/approve$/);
    if (publicApproveMatch && request.method === "POST") {
      const tokenHash = await hashReviewToken(publicApproveMatch[1], env);
      const row = await env.DB.prepare(
        `SELECT rt.id AS review_token_id, rt.post_id, rt.expires_at, rt.used_at,
                p.status, p.suggested_publish_at
         FROM review_tokens rt
         JOIN posts p ON p.id = rt.post_id
         WHERE rt.token_hash = ?`
      ).bind(tokenHash).first<any>();

      if (!row || row.expires_at <= Date.now() || row.used_at) {
        return response(request, env, { error: "This review link is invalid, expired, or already used." }, { status: 409 });
      }
      if (!row.suggested_publish_at) {
        return response(request, env, { error: "This post does not have a proposed publishing slot." }, { status: 409 });
      }

      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE posts SET
             status = 'calendar_scheduled',
             approved_at = ?,
             calendar_added_at = ?,
             scheduled_publish_at = suggested_publish_at,
             updated_at = ?
           WHERE id = ?`
        ).bind(now, now, now, row.post_id),
        env.DB.prepare(
          "UPDATE review_tokens SET used_at = ? WHERE id = ?"
        ).bind(Date.now(), row.review_token_id),
        env.DB.prepare(
          `INSERT INTO approvals
             (id, post_id, decision, previous_status)
           VALUES (?, ?, 'approved_via_review_link', ?)`
        ).bind(crypto.randomUUID(), row.post_id, row.status),
      ]);
      await audit(env, row.post_id, "post.approved_via_review_link");
      return response(request, env, { ok: true, postId: row.post_id, status: "calendar_scheduled" });
    }

    const authRoute = await handleAuthRoute(request, url, env);
    if (authRoute) {
      return response(
        request,
        env,
        authRoute.body,
        authRoute.status ? { status: authRoute.status } : {}
      );
    }

    const sessionUser = url.pathname.startsWith("/v1/")
      ? await getSessionUser(request, env)
      : null;
    if (url.pathname.startsWith("/v1/") && !sessionUser) {
      return response(
        request,
        env,
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const brandMatch = url.pathname.match(/^\/v1\/clients\/([^/]+)\/brand$/);
    if (brandMatch && request.method === "GET") {
      const row = await env.DB.prepare(
        `SELECT c.id AS client_id, c.name, c.timezone,
                bp.id, bp.voice, bp.audience, bp.primary_color, bp.secondary_color,
                bp.website, bp.social_handles, bp.restricted_words, bp.tagline,
                bp.preferred_ctas, bp.imagery_preferences, bp.posting_rules
         FROM clients c
         LEFT JOIN brand_profiles bp ON bp.client_id = c.id
         WHERE c.id = ?`
      ).bind(brandMatch[1]).first();
      if (!row) return response(request, env, { error: "Client not found" }, { status: 404 });
      return response(request, env, { data: row });
    }

    if (brandMatch && request.method === "POST") {
      const payload = await request.json<any>().catch(() => ({}));
      const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?")
        .bind(brandMatch[1]).first();
      if (!client) return response(request, env, { error: "Client not found" }, { status: 404 });

      const current = await env.DB.prepare("SELECT id FROM brand_profiles WHERE client_id = ?")
        .bind(brandMatch[1]).first<{ id: string }>();
      const id = current?.id || crypto.randomUUID();

      await env.DB.prepare(
        `INSERT INTO brand_profiles
         (id, client_id, voice, audience, primary_color, secondary_color, website,
          social_handles, restricted_words, tagline, preferred_ctas,
          imagery_preferences, posting_rules, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(client_id) DO UPDATE SET
           voice = excluded.voice,
           audience = excluded.audience,
           primary_color = excluded.primary_color,
           secondary_color = excluded.secondary_color,
           website = excluded.website,
           social_handles = excluded.social_handles,
           restricted_words = excluded.restricted_words,
           tagline = excluded.tagline,
           preferred_ctas = excluded.preferred_ctas,
           imagery_preferences = excluded.imagery_preferences,
           posting_rules = excluded.posting_rules,
           updated_at = CURRENT_TIMESTAMP`
      ).bind(
        id,
        brandMatch[1],
        payload.voice || null,
        payload.audience || null,
        payload.primaryColor || null,
        payload.secondaryColor || null,
        payload.website || null,
        payload.socialHandles ? JSON.stringify(payload.socialHandles) : null,
        payload.restrictedWords || null,
        payload.tagline || null,
        payload.preferredCtas || null,
        payload.imageryPreferences || null,
        payload.postingRules || null
      ).run();

      return response(request, env, { ok: true, id });
    }

    if (request.method === "POST" && url.pathname === "/v1/generation-jobs") {
      const payload = await request.json<{
        clientId?: string;
        objective?: string;
        assetIds?: string[];
      }>().catch(() => ({}));

      if (!payload.clientId || !payload.assetIds?.length) {
        return response(request, env, { error: "clientId and assetIds are required." }, { status: 400 });
      }

      const placeholders = payload.assetIds.map(() => "?").join(",");
      const owned = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM assets
         WHERE client_id = ? AND id IN (${placeholders})`
      ).bind(payload.clientId, ...payload.assetIds).first<{ count: number }>();

      if (Number(owned?.count || 0) !== payload.assetIds.length) {
        return response(request, env, { error: "One or more assets do not belong to this client." }, { status: 400 });
      }

      const jobId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO generation_jobs
         (id, client_id, requested_by, objective, asset_ids, status)
         VALUES (?, ?, ?, ?, ?, 'queued')`
      ).bind(
        jobId,
        payload.clientId,
        sessionUser?.id || null,
        payload.objective || "Auto",
        JSON.stringify(payload.assetIds)
      ).run();

      await env.GENERATION_QUEUE.send({ kind: "generate", jobId });
      return response(request, env, { ok: true, jobId, status: "queued" }, { status: 202 });
    }

    if (request.method === "GET" && url.pathname === "/v1/clients") {
      const result = await env.DB.prepare(
        `SELECT c.id, c.name, c.timezone, COALESCE(bp.primary_color, '#A56CFF') AS color
         FROM clients c
         LEFT JOIN brand_profiles bp ON bp.client_id = c.id
         ORDER BY c.name`
      ).all();
      return response(request, env, { data: result.results });
    }

    if (request.method === "POST" && url.pathname === "/v1/assets") {
      const clientId = request.headers.get("x-client-id")?.trim();
      const filename = request.headers.get("x-file-name")?.trim() || "upload.jpg";
      const contentType = request.headers.get("content-type") || "application/octet-stream";
      const declaredSize = Number(request.headers.get("content-length") || "0");

      if (!clientId) return response(request, env, { error: "x-client-id is required" }, { status: 400 });
      if (!contentType.startsWith("image/")) {
        return response(request, env, { error: "Only image uploads are accepted" }, { status: 415 });
      }
      if (declaredSize > MAX_IMAGE_BYTES) {
        return response(request, env, { error: "Image exceeds the 20 MB upload limit" }, { status: 413 });
      }

      const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first();
      if (!client) return response(request, env, { error: "Client not found" }, { status: 404 });

      const body = await request.arrayBuffer();
      if (body.byteLength > MAX_IMAGE_BYTES) {
        return response(request, env, { error: "Image exceeds the 20 MB upload limit" }, { status: 413 });
      }

      const id = crypto.randomUUID();
      const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120);
      const key = `clients/${clientId}/originals/${id}-${safeName}`;

      await env.MEDIA.put(key, body, {
        httpMetadata: { contentType },
        customMetadata: { clientId, originalFilename: filename },
      });

      await env.DB.prepare(
        `INSERT INTO assets
         (id, client_id, r2_key, filename, content_type, size_bytes, status)
         VALUES (?, ?, ?, ?, ?, ?, 'uploaded')`
      )
        .bind(id, clientId, key, filename, contentType, body.byteLength)
        .run();

      return response(request, env, {
        data: {
          id,
          clientId,
          filename,
          contentType,
          status: "uploaded",
          url: `/v1/assets/${id}`,
          createdAt: new Date().toISOString(),
        },
      }, { status: 201 });
    }

    const assetMatch = url.pathname.match(/^\/v1\/assets\/([^/]+)$/);
    if (request.method === "GET" && assetMatch) {
      const row = await env.DB.prepare(
        "SELECT r2_key, content_type FROM assets WHERE id = ?"
      ).bind(assetMatch[1]).first<{ r2_key: string; content_type: string }>();
      if (!row) return response(request, env, { error: "Asset not found" }, { status: 404 });

      const object = await env.MEDIA.get(row.r2_key);
      if (!object) return response(request, env, { error: "Asset object not found" }, { status: 404 });

      return new Response(object.body, {
        headers: {
          "content-type": row.content_type,
          "cache-control": "private, max-age=300",
          etag: object.httpEtag,
          ...policy.headers,
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/posts/review") {
      const result = await env.DB.prepare(
        postSelect("WHERE p.status = ? ORDER BY p.suggested_publish_at ASC")
      ).bind("awaiting_approval").all();
      return response(request, env, { data: result.results });
    }

    if (request.method === "GET" && url.pathname === "/v1/posts/calendar") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!from || !to) return response(request, env, { error: "from and to are required" }, { status: 400 });

      const result = await env.DB.prepare(
        postSelect(
          `WHERE p.scheduled_publish_at IS NOT NULL
           AND p.scheduled_publish_at >= ?
           AND p.scheduled_publish_at < ?
           AND p.status IN ('calendar_scheduled','pre_publish','rescheduled','publishing','published','failed')
           ORDER BY p.scheduled_publish_at ASC`
        )
      ).bind(from, to).all();

      return response(request, env, { data: result.results });
    }

    const postMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)$/);
    if (request.method === "GET" && postMatch) {
      const post = await getPost(env, postMatch[1]);
      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });
      return response(request, env, { data: post });
    }

    const approvalMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/approve$/);
    if (request.method === "POST" && approvalMatch) {
      const postId = approvalMatch[1];
      const now = new Date().toISOString();
      const post = await env.DB.prepare(
        "SELECT status, suggested_publish_at FROM posts WHERE id = ?"
      ).bind(postId).first<{ status: string; suggested_publish_at: string | null }>();

      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });
      if (!post.suggested_publish_at) {
        return response(request, env, { error: "Post does not have a proposed publishing slot" }, { status: 409 });
      }

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE posts SET
           status = 'calendar_scheduled',
           approved_at = ?,
           calendar_added_at = ?,
           scheduled_publish_at = suggested_publish_at,
           updated_at = ?
           WHERE id = ?`
        ).bind(now, now, now, postId),
        env.DB.prepare(
          `INSERT INTO approvals (id, post_id, decision, previous_status)
           VALUES (?, ?, 'approved', ?)`
        ).bind(crypto.randomUUID(), postId, post.status),
      ]);
      await audit(env, postId, "post.approved");

      return response(request, env, { ok: true, postId, status: "calendar_scheduled" });
    }

    const keepMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/keep-schedule$/);
    if (request.method === "POST" && keepMatch) {
      const postId = keepMatch[1];
      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE posts SET prepublish_response = 'keep', status = 'calendar_scheduled', updated_at = ? WHERE id = ?`
      ).bind(now, postId).run();
      await audit(env, postId, "post.keep_schedule");
      return response(request, env, { ok: true, postId, status: "calendar_scheduled" });
    }

    const rescheduleMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/reschedule$/);
    if (request.method === "POST" && rescheduleMatch) {
      const postId = rescheduleMatch[1];
      const payload = await request.json<{ scheduledPublishAt?: string }>().catch(() => ({}));
      if (!payload.scheduledPublishAt || Number.isNaN(Date.parse(payload.scheduledPublishAt))) {
        return response(request, env, { error: "A valid scheduledPublishAt value is required" }, { status: 400 });
      }

      await env.DB.prepare(
        `UPDATE posts SET
         scheduled_publish_at = ?,
         prepublish_response = 'reschedule',
         prepublish_alert_at = NULL,
         status = 'rescheduled',
         updated_at = ?
         WHERE id = ?`
      ).bind(payload.scheduledPublishAt, new Date().toISOString(), postId).run();

      await audit(env, postId, "post.rescheduled", { scheduledPublishAt: payload.scheduledPublishAt });
      return response(request, env, { ok: true, postId, status: "rescheduled" });
    }

    const publishNowMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/publish-now$/);
    if (request.method === "POST" && publishNowMatch) {
      const postId = publishNowMatch[1];
      const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ?").bind(postId).first();
      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });

      await env.DB.prepare(
        "UPDATE posts SET prepublish_response = 'publish_now', updated_at = ? WHERE id = ?"
      ).bind(new Date().toISOString(), postId).run();

      await env.PUBLISH_QUEUE.send({
        kind: "publish",
        postId,
        idempotencyKey: `manual:${postId}:${crypto.randomUUID()}`,
      });
      await audit(env, postId, "post.publish_now");

      return response(request, env, { ok: true, queued: true, postId });
    }

    return response(request, env, { error: "Not found" }, { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const now = new Date();
    const nowIso = now.toISOString();
    const alertCutoff = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    const upcoming = await env.DB.prepare(
      `SELECT id FROM posts
       WHERE status IN ('calendar_scheduled','rescheduled')
       AND scheduled_publish_at > ?
       AND scheduled_publish_at <= ?
       AND prepublish_alert_at IS NULL
       LIMIT 100`
    ).bind(nowIso, alertCutoff).all<{ id: string }>();

    for (const row of upcoming.results) {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO notifications
           (id, post_id, type, channel, status, scheduled_for)
           VALUES (?, ?, 'pre_publish', 'in_app', 'queued', ?)`
        ).bind(crypto.randomUUID(), row.id, nowIso),
        env.DB.prepare(
          "UPDATE posts SET status = 'pre_publish', prepublish_alert_at = ?, updated_at = ? WHERE id = ?"
        ).bind(nowIso, nowIso, row.id),
      ]);
    }

    const due = await env.DB.prepare(
      `SELECT id FROM posts
       WHERE status IN ('calendar_scheduled','pre_publish','rescheduled')
       AND scheduled_publish_at IS NOT NULL
       AND scheduled_publish_at <= ?
       ORDER BY scheduled_publish_at ASC
       LIMIT 100`
    ).bind(nowIso).all<{ id: string }>();

    for (const row of due.results) {
      await env.PUBLISH_QUEUE.send({
        kind: "publish",
        postId: row.id,
        idempotencyKey: `scheduled:${row.id}:${nowIso.slice(0, 16)}`,
      });
    }
  },

  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      if (message.body.kind === "generate") {
        try {
          await runGenerationJob(env, message.body.jobId);
          message.ack();
        } catch (error) {
          await env.DB.prepare(
            `UPDATE generation_jobs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`
          ).bind(
            error instanceof Error ? error.message.slice(0, 1500) : "Generation failed",
            new Date().toISOString(),
            message.body.jobId
          ).run();
          message.retry();
        }
        continue;
      }

      const existing = await env.DB.prepare(
        "SELECT id FROM publish_attempts WHERE idempotency_key = ?"
      ).bind(message.body.idempotencyKey).first();

      if (existing) {
        message.ack();
        continue;
      }

      const attemptId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO publish_attempts
           (id, post_id, idempotency_key, status)
           VALUES (?, ?, ?, 'queued')`
        ).bind(attemptId, message.body.postId, message.body.idempotencyKey),
        env.DB.prepare(
          "UPDATE posts SET status = 'publishing', updated_at = ? WHERE id = ?"
        ).bind(new Date().toISOString(), message.body.postId),
      ]);

      // Platform adapters (Meta, LinkedIn, TikTok, X) are intentionally isolated
      // behind this queue consumer and connect in the next integration phase.
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, JobMessage>;

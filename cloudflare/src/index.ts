import { getSessionUser, handleAuthRoute } from "./auth";
import { handleManagementRoute } from "./management";
import { notifyPostOwners } from "./notifications";
import { createSignedMediaToken, hashSecret, verifySignedMediaToken } from "./security";
import { publishPostToSocial, socialOAuthCallback, syncAccountAnalytics } from "./social";
import { findNextAvailableSlot } from "./scheduling";
import {
  editPostGraphicWithAI,
  hashReviewToken,
  regeneratePostWithAI,
  rewritePostCaptionWithAI,
  runGenerationJob,
} from "./generation";

interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  PUBLISH_QUEUE: Queue<JobMessage>;
  GENERATION_QUEUE: Queue<JobMessage>;
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
  AUTH_PEPPER?: string;
  AUTH_ALLOWED_EMAILS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_FROM_NAME?: string;
  REVIEW_NOTIFICATION_EMAIL?: string;
  REVIEW_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
  OPENAI_FAST_MODEL?: string;
  OPENAI_IMAGE_MODEL?: string;
  OPENAI_IMAGE_EDIT_MODEL?: string;
  OPENAI_IMAGE_QUALITY?: "low" | "medium" | "high" | "xhigh" | "max" | "auto";
  OPENAI_IMAGE_SIZE?: string;
  SOCIAL_TOKEN_KEY?: string;
  PUBLIC_BASE_URL?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_REDIRECT_URI?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_REDIRECT_URI?: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  TIKTOK_REDIRECT_URI?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_REDIRECT_URI?: string;
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
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
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
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": "default-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
    sa.account_name AS social_account_name,
    CASE WHEN p.graphic_key IS NOT NULL THEN '/v1/media/' || p.graphic_key ELSE NULL END AS image_url
    FROM posts p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN brand_profiles bp ON bp.client_id = p.client_id
    LEFT JOIN social_accounts sa ON sa.id = p.social_account_id
    ${where}`;
}

async function decoratePostMedia(env: Env, post: any) {
  if (post?.graphic_key) {
    post.image_url = `/v1/public/media/${encodeURIComponent(await createSignedMediaToken(post.graphic_key, env))}`;
  }
  return post;
}

async function decoratePostList(env: Env, rows: any[]) {
  return Promise.all(rows.map((row) => decoratePostMedia(env, row)));
}

async function getPost(env: Env, postId: string) {
  const post = await env.DB.prepare(postSelect("WHERE p.id = ?")).bind(postId).first<any>();
  return decoratePostMedia(env, post);
}

async function audit(env: Env, postId: string, action: string, metadata?: unknown, actorId = "system") {
  await env.DB.prepare(
    "INSERT INTO audit_logs (id, post_id, actor_id, action, metadata) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      crypto.randomUUID(),
      postId,
      actorId,
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

    const signedMediaMatch = url.pathname.match(/^\/v1\/public\/media\/([^/]+)$/);
    if (signedMediaMatch && request.method === "GET") {
      const verified = await verifySignedMediaToken(decodeURIComponent(signedMediaMatch[1]), env).catch(() => null);
      if (!verified) {
        return response(request, env, { error: "Media link is invalid or expired." }, { status: 404 });
      }
      const object = await env.MEDIA.get(verified.key);
      if (!object) return response(request, env, { error: "Media not found." }, { status: 404 });
      return new Response(object.body, {
        headers: {
          "content-type": object.httpMetadata?.contentType || "application/octet-stream",
          "cache-control": "private, max-age=300",
          "x-content-type-options": "nosniff",
          etag: object.httpEtag,
          ...policy.headers,
        },
      });
    }

    const publicPublishMediaMatch = url.pathname.match(/^\/v1\/public\/publish-media\/([^/]+)$/);
    if (publicPublishMediaMatch && request.method === "GET") {
      const tokenHash = await hashSecret(publicPublishMediaMatch[1], env.AUTH_PEPPER || "");
      const row = await env.DB.prepare(
        "SELECT r2_key, expires_at FROM publish_media_tokens WHERE token_hash = ?"
      ).bind(tokenHash).first<{ r2_key: string; expires_at: number }>();
      if (!row || row.expires_at <= Date.now()) {
        return response(request, env, { error: "Publish media link is invalid or expired." }, { status: 404 });
      }
      const object = await env.MEDIA.get(row.r2_key);
      if (!object) return response(request, env, { error: "Publish media not found." }, { status: 404 });
      return new Response(object.body, {
        headers: {
          "content-type": object.httpMetadata?.contentType || "image/jpeg",
          "cache-control": "public, max-age=900",
          etag: object.httpEtag,
        },
      });
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
      row.image_url = row.graphic_key
        ? "/v1/public/review/" + encodeURIComponent(publicReviewMatch[1]) + "/media"
        : null;
      return response(request, env, { data: row });
    }

    const publicMediaMatch = url.pathname.match(/^\/v1\/public\/review\/([^/]+)\/media$/);
    if (publicMediaMatch && request.method === "GET") {
      const tokenHash = await hashReviewToken(publicMediaMatch[1], env);
      const row = await env.DB.prepare(
        "SELECT p.graphic_key, rt.expires_at FROM review_tokens rt JOIN posts p ON p.id = rt.post_id WHERE rt.token_hash = ?"
      ).bind(tokenHash).first<{ graphic_key?: string | null; expires_at: number }>();
      if (!row || row.expires_at <= Date.now() || !row.graphic_key) {
        return response(request, env, { error: "Review image unavailable." }, { status: 404 });
      }
      const object = await env.MEDIA.get(row.graphic_key);
      if (!object) return response(request, env, { error: "Review image unavailable." }, { status: 404 });
      return new Response(object.body, {
        headers: {
          "content-type": object.httpMetadata?.contentType || "image/jpeg",
          "cache-control": "private, max-age=300",
          etag: object.httpEtag,
          ...policy.headers,
        },
      });
    }

    const publicApproveMatch = url.pathname.match(/^\/v1\/public\/review\/([^/]+)\/approve$/);
    if (publicApproveMatch && request.method === "POST") {
      const tokenHash = await hashReviewToken(publicApproveMatch[1], env);
      const row = await env.DB.prepare(
        `SELECT rt.id AS review_token_id, rt.post_id, rt.expires_at, rt.used_at,
                p.status, p.client_id, p.suggested_publish_at, p.social_account_id
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
      if (!row.social_account_id) {
        return response(request, env, { error: "Assign a connected social account before approving this post." }, { status: 409 });
      }

      const now = new Date().toISOString();
      const scheduledAt = await findNextAvailableSlot(
        env,
        row.client_id,
        row.suggested_publish_at
      );
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE posts SET
             status = 'calendar_scheduled',
             approved_at = ?,
             calendar_added_at = ?,
             scheduled_publish_at = ?,
             updated_at = ?
           WHERE id = ?`
        ).bind(now, now, scheduledAt, now, row.post_id),
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

    const socialCallbackMatch = url.pathname.match(/^\/v1\/social\/(meta|linkedin|tiktok|x)\/callback$/);
    if (request.method === "GET" && socialCallbackMatch) {
      try {
        const destination = await socialOAuthCallback(env, url, socialCallbackMatch[1] as any);
        return Response.redirect(destination, 302);
      } catch (error) {
        return response(
          request,
          env,
          { error: error instanceof Error ? error.message : "Social connection failed." },
          { status: 400 }
        );
      }
    }

    const authRoute = await handleAuthRoute(request, url, env);
    if (authRoute) {
      if ("response" in authRoute && authRoute.response) {
        return authRoute.response;
      }
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

    if (sessionUser) {
      const managed = await handleManagementRoute(request, url, env, sessionUser);
      if (managed) {
        if ("response" in managed) return managed.response;
        return response(
          request,
          env,
          managed.body,
          managed.status ? { status: managed.status } : {}
        );
      }
    }

    if (request.method === "GET" && url.pathname.startsWith("/v1/media/")) {
      const key = decodeURIComponent(url.pathname.slice("/v1/media/".length));
      if (!key) return response(request, env, { error: "Media key is required." }, { status: 400 });
      const object = await env.MEDIA.get(key);
      if (!object) return response(request, env, { error: "Media not found." }, { status: 404 });
      return new Response(object.body, {
        headers: {
          "content-type": object.httpMetadata?.contentType || "application/octet-stream",
          "cache-control": "private, max-age=300",
          etag: object.httpEtag,
          ...policy.headers,
        },
      });
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
      const payload = await request.json<any>().catch(() => ({} as any));
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
      }>().catch(() => ({} as any));

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
      return response(request, env, { data: await decoratePostList(env, result.results as any[]) });
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
           AND p.status IN ('calendar_scheduled','pre_publish','rescheduled','publish_queued','publishing','published','failed')
           ORDER BY p.scheduled_publish_at ASC`
        )
      ).bind(from, to).all();

      return response(request, env, { data: await decoratePostList(env, result.results as any[]) });
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
        "SELECT status, client_id, suggested_publish_at, social_account_id FROM posts WHERE id = ?"
      ).bind(postId).first<{ status: string; client_id: string; suggested_publish_at: string | null; social_account_id: string | null }>();

      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });
      if (!post.suggested_publish_at) {
        return response(request, env, { error: "Post does not have a proposed publishing slot" }, { status: 409 });
      }
      if (!post.social_account_id) {
        return response(request, env, { error: "Assign a connected social account before approving this post." }, { status: 409 });
      }

      const scheduledAt = await findNextAvailableSlot(
        env,
        post.client_id,
        post.suggested_publish_at,
        postId
      );
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE posts SET
           status = 'calendar_scheduled',
           approved_at = ?,
           calendar_added_at = ?,
           scheduled_publish_at = ?,
           updated_at = ?
           WHERE id = ?`
        ).bind(now, now, scheduledAt, now, postId),
        env.DB.prepare(
          `INSERT INTO approvals (id, post_id, decision, previous_status)
           VALUES (?, ?, 'approved', ?)`
        ).bind(crypto.randomUUID(), postId, post.status),
      ]);
      await audit(env, postId, "post.approved", undefined, sessionUser?.id || "system");

      return response(request, env, { ok: true, postId, status: "calendar_scheduled" });
    }

    const keepMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/keep-schedule$/);
    if (request.method === "POST" && keepMatch) {
      const postId = keepMatch[1];
      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE posts SET prepublish_response = 'keep', status = 'calendar_scheduled', updated_at = ? WHERE id = ?`
      ).bind(now, postId).run();
      await audit(env, postId, "post.keep_schedule", undefined, sessionUser?.id || "system");
      return response(request, env, { ok: true, postId, status: "calendar_scheduled" });
    }

    const rescheduleMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/reschedule$/);
    if (request.method === "POST" && rescheduleMatch) {
      const postId = rescheduleMatch[1];
      const payload = await request.json<{ scheduledPublishAt?: string }>().catch(() => ({} as any));
      if (!payload.scheduledPublishAt || Number.isNaN(Date.parse(payload.scheduledPublishAt))) {
        return response(request, env, { error: "A valid scheduledPublishAt value is required" }, { status: 400 });
      }

      const post = await env.DB.prepare(
        "SELECT client_id FROM posts WHERE id = ?"
      ).bind(postId).first<{ client_id: string }>();
      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });

      const scheduledAt = await findNextAvailableSlot(
        env,
        post.client_id,
        payload.scheduledPublishAt,
        postId
      );

      await env.DB.prepare(
        `UPDATE posts SET
         scheduled_publish_at = ?,
         prepublish_response = 'reschedule',
         prepublish_alert_at = NULL,
         status = 'rescheduled',
         updated_at = ?
         WHERE id = ?`
      ).bind(scheduledAt, new Date().toISOString(), postId).run();

      await audit(env, postId, "post.rescheduled", {
        requestedPublishAt: payload.scheduledPublishAt,
        scheduledPublishAt: scheduledAt
      }, sessionUser?.id || "system");
      return response(request, env, { ok: true, postId, status: "rescheduled", scheduledPublishAt: scheduledAt });
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
      await audit(env, postId, "post.publish_now", undefined, sessionUser?.id || "system");

      return response(request, env, { ok: true, queued: true, postId });
    }


    const rewriteCaptionMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/ai-rewrite-caption$/);
    if (rewriteCaptionMatch && request.method === "POST") {
      const payload = await request.json<{ instruction?: string }>().catch(() => ({} as any));
      const instruction = payload.instruction?.trim().slice(0, 2000);
      try {
        const data = await rewritePostCaptionWithAI(env, rewriteCaptionMatch[1], instruction);
        await audit(env, rewriteCaptionMatch[1], "post.ai_caption_rewritten", { instruction: instruction || null }, sessionUser?.id || "system");
        return response(request, env, { ok: true, data });
      } catch (error) {
        return response(request, env, { error: error instanceof Error ? error.message : "Unable to rewrite caption." }, { status: 502 });
      }
    }

    const editImageMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/ai-edit-image$/);
    if (editImageMatch && request.method === "POST") {
      const payload = await request.json<{ instruction?: string }>().catch(() => ({} as any));
      const instruction = payload.instruction?.trim().slice(0, 2000) || "";
      if (!instruction) return response(request, env, { error: "instruction is required." }, { status: 400 });
      try {
        const data = await editPostGraphicWithAI(env, editImageMatch[1], instruction);
        await audit(env, editImageMatch[1], "post.ai_graphic_edited", { instruction }, sessionUser?.id || "system");
        return response(request, env, { ok: true, data });
      } catch (error) {
        return response(request, env, { error: error instanceof Error ? error.message : "Unable to edit graphic." }, { status: 502 });
      }
    }

    const regenerateMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/ai-regenerate$/);
    if (regenerateMatch && request.method === "POST") {
      const payload = await request.json<{ instruction?: string }>().catch(() => ({} as any));
      const instruction = payload.instruction?.trim().slice(0, 2000);
      try {
        const data = await regeneratePostWithAI(env, regenerateMatch[1], instruction);
        await audit(env, regenerateMatch[1], "post.ai_regenerated", { instruction: instruction || null }, sessionUser?.id || "system");
        return response(request, env, { ok: true, data });
      } catch (error) {
        return response(request, env, { error: error instanceof Error ? error.message : "Unable to regenerate post." }, { status: 502 });
      }
    }

    return response(request, env, { error: "Not found" }, { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = new Date();
    const nowIso = now.toISOString();

    const upcoming = await env.DB.prepare(
      `SELECT p.id, p.client_id, p.platform, p.scheduled_publish_at,
              COALESCE(cs.prepublish_minutes, np.prepublish_minutes,
                       ws.default_prepublish_minutes, 30) AS prepublish_minutes
       FROM posts p
       JOIN workspace_settings ws ON ws.id = 'default'
       LEFT JOIN client_settings cs ON cs.client_id = p.client_id
       LEFT JOIN users u ON u.role = 'owner'
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE p.status IN ('calendar_scheduled','rescheduled')
         AND p.scheduled_publish_at IS NOT NULL
         AND p.prepublish_alert_at IS NULL
       LIMIT 100`
    ).all<any>();

    for (const row of upcoming.results) {
      const alertAt = new Date(row.scheduled_publish_at).getTime() -
        Number(row.prepublish_minutes || 30) * 60 * 1000;
      if (alertAt <= Date.now()) {
        await env.DB.prepare(
          "UPDATE posts SET status = 'pre_publish', prepublish_alert_at = ?, updated_at = ? WHERE id = ?"
        ).bind(nowIso, nowIso, row.id).run();

        const deepLink = env.PUBLIC_BASE_URL
          ? `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/posts/${row.id}/publish`
          : undefined;
        await notifyPostOwners(
          env,
          row.id,
          "pre_publish",
          "Post ready for final publish decision",
          `Your ${row.platform} post is scheduled for ${new Date(row.scheduled_publish_at).toLocaleString()}. Keep the schedule, reschedule it, or publish now.`,
          deepLink
        );
      }
    }

    const due = await env.DB.prepare(
      `SELECT p.id, p.prepublish_response, p.scheduled_publish_at,
              COALESCE(cs.no_response_policy, np.no_response_policy,
                       ws.default_no_response_policy, 'auto_publish') AS no_response_policy
       FROM posts p
       JOIN workspace_settings ws ON ws.id = 'default'
       LEFT JOIN client_settings cs ON cs.client_id = p.client_id
       LEFT JOIN users u ON u.role = 'owner'
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE p.status IN ('calendar_scheduled','pre_publish','rescheduled')
         AND p.scheduled_publish_at IS NOT NULL
         AND p.scheduled_publish_at <= ?
       ORDER BY p.scheduled_publish_at ASC
       LIMIT 100`
    ).bind(nowIso).all<any>();

    for (const row of due.results) {
      const policy = row.prepublish_response
        ? "auto_publish"
        : row.no_response_policy || "auto_publish";

      if (policy === "hold") {
        await env.DB.prepare(
          "UPDATE posts SET status = 'paused', updated_at = ? WHERE id = ?"
        ).bind(nowIso, row.id).run();
        await notifyPostOwners(
          env,
          row.id,
          "publish_held",
          "Post held for confirmation",
          "This post reached its scheduled time without a response, so BrandSparQ held it."
        );
        continue;
      }

      if (policy === "skip") {
        await env.DB.prepare(
          "UPDATE posts SET status = 'canceled', updated_at = ? WHERE id = ?"
        ).bind(nowIso, row.id).run();
        await notifyPostOwners(
          env,
          row.id,
          "publish_skipped",
          "Scheduled post skipped",
          "This post reached its scheduled time without a response and was skipped by your workspace policy."
        );
        continue;
      }

      const claimed = await env.DB.prepare(
        `UPDATE posts SET status = 'publish_queued', updated_at = ?
         WHERE id = ? AND status IN ('calendar_scheduled','pre_publish','rescheduled')`
      ).bind(nowIso, row.id).run();

      if (claimed.meta.changes === 1) {
        await env.PUBLISH_QUEUE.send({
          kind: "publish",
          postId: row.id,
          idempotencyKey: `scheduled:${row.id}:${row.scheduled_publish_at}`,
        });
      }
    }

    const settings = await env.DB.prepare(
      "SELECT analytics_refresh_hours FROM workspace_settings WHERE id = 'default'"
    ).first<{ analytics_refresh_hours: number }>();
    const refreshMs = Number(settings?.analytics_refresh_hours || 6) * 60 * 60 * 1000;
    const accounts = await env.DB.prepare(
      `SELECT sa.id,
          MAX(CASE WHEN ar.status = 'completed' THEN ar.completed_at END) AS last_sync
       FROM social_accounts sa
       LEFT JOIN analytics_sync_runs ar ON ar.social_account_id = sa.id
       WHERE sa.status = 'connected'
       GROUP BY sa.id`
    ).all<{ id: string; last_sync: string | null }>();

    for (const account of accounts.results) {
      const last = account.last_sync ? Date.parse(account.last_sync) : 0;
      if (!last || Date.now() - last >= refreshMs) {
        try { await syncAccountAnalytics(env, account.id); } catch {}
      }
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

      const executionKey = message.body.idempotencyKey;
      const jobId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO publish_jobs (id, post_id, execution_key, state)
         VALUES (?, ?, ?, 'queued')`
      ).bind(jobId, message.body.postId, executionKey).run();

      const job = await env.DB.prepare(
        "SELECT id, state, attempt_count FROM publish_jobs WHERE execution_key = ?"
      ).bind(executionKey).first<{ id: string; state: string; attempt_count: number }>();

      if (!job) {
        message.retry({ delaySeconds: 60 });
        continue;
      }
      if (job.state === "completed") {
        message.ack();
        continue;
      }
      if (job.state === "publishing") {
        // A duplicate delivery is already being processed by another consumer.
        message.ack();
        continue;
      }

      const post = await env.DB.prepare(
        "SELECT id, social_account_id, publish_retry_count FROM posts WHERE id = ?"
      ).bind(message.body.postId).first<any>();

      if (!post?.social_account_id) {
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE posts SET status = 'failed', failure_code = 'SOCIAL_ACCOUNT_REQUIRED',
               failure_message = 'Connect and assign a social account before publishing.',
               updated_at = ? WHERE id = ?`
          ).bind(new Date().toISOString(), message.body.postId),
          env.DB.prepare(
            "UPDATE publish_jobs SET state='failed',last_error=?,updated_at=? WHERE id=?"
          ).bind("SOCIAL_ACCOUNT_REQUIRED",new Date().toISOString(),job.id),
        ]);
        await notifyPostOwners(
          env,
          message.body.postId,
          "publish_failed",
          "BrandSparQ could not publish this post",
          "A connected social account must be assigned before publishing."
        );
        message.ack();
        continue;
      }

      const attemptNumber = Number(job.attempt_count || 0) + 1;
      const attemptId = crypto.randomUUID();
      const attemptKey = `${executionKey}:attempt:${attemptNumber}`;
      const attemptNow = new Date().toISOString();

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE publish_jobs SET state='publishing',attempt_count=?,claimed_at=?,
             updated_at=? WHERE id=?`
        ).bind(attemptNumber,attemptNow,attemptNow,job.id),
        env.DB.prepare(
          `INSERT INTO publish_attempts
           (id, post_id, idempotency_key, attempt, status)
           VALUES (?, ?, ?, ?, 'publishing')`
        ).bind(attemptId, message.body.postId, attemptKey, attemptNumber),
        env.DB.prepare(
          `UPDATE posts SET status = 'publishing', publish_started_at = COALESCE(publish_started_at, ?),
             last_publish_attempt_at = ?, updated_at = ? WHERE id = ?`
        ).bind(attemptNow,attemptNow,attemptNow,message.body.postId),
      ]);

      try {
        await publishPostToSocial(env, message.body.postId);
        const completedAt = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE publish_attempts SET status = 'published' WHERE id = ?"
          ).bind(attemptId),
          env.DB.prepare(
            "UPDATE publish_jobs SET state='completed',completed_at=?,last_error=NULL,updated_at=? WHERE id=?"
          ).bind(completedAt,completedAt,job.id),
        ]);
        await notifyPostOwners(
          env,
          message.body.postId,
          "published",
          "Post published",
          "BrandSparQ successfully published your scheduled post."
        );
        message.ack();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message.slice(0, 1500) : "Publishing failed";
        const retryCount = Number(post.publish_retry_count || 0) + 1;
        const failedAt = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE publish_attempts SET status = 'failed', error_message = ? WHERE id = ?`
          ).bind(errorMessage, attemptId),
          env.DB.prepare(
            `UPDATE publish_jobs SET state=?,last_error=?,updated_at=? WHERE id=?`
          ).bind(retryCount >= 3 ? "failed" : "retrying",errorMessage,failedAt,job.id),
          env.DB.prepare(
            `UPDATE posts SET status = ?, publish_retry_count = ?, failure_code = 'PROVIDER_ERROR',
               failure_message = ?, updated_at = ? WHERE id = ?`
          ).bind(
            retryCount >= 3 ? "failed" : "publish_queued",
            retryCount,
            errorMessage,
            failedAt,
            message.body.postId
          ),
        ]);

        if (retryCount >= 3) {
          await notifyPostOwners(
            env,
            message.body.postId,
            "publish_failed",
            "Post failed to publish",
            errorMessage
          );
          message.ack();
        } else {
          message.retry({ delaySeconds: Math.min(3600, 60 * 2 ** retryCount) });
        }
      }
    }
  },
} satisfies ExportedHandler<Env, JobMessage>;

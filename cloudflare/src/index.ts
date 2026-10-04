import { getSessionUser, handleAuthRoute, type SessionUser } from "./auth";
import { accessibleClientIds, hasClientAccess, hasPermission, type Permission } from "./authz";
import { issuePostMediaUrl, resolveMediaToken } from "./media";
import {
  claimPublishJob,
  ensurePublishJob,
  markPublishJobCompleted,
  markPublishJobFailed,
  markPublishJobRetry,
  type PublishQueueMessage,
} from "./publishing";
import { handleManagementRoute } from "./management";
import {
  enforceRateLimit,
  handleOperationsRoute,
  readiness,
  recordSystemEvent,
  recoverStaleWork,
} from "./operations";
import { checkExpoPushReceipts, notifyPostOwners } from "./notifications";
import { hashSecret } from "./security";
import {
  checkPendingPublishReceipts,
  ensurePostSocialDestination,
  handleMetaWebhook,
  publishPostToSocial,
  socialOAuthCallback,
  syncAccountAnalytics,
  verifySocialAccount,
} from "./social";
import { findNextAvailableSlot } from "./scheduling";
import {
  editPostGraphicWithAI,
  hashReviewToken,
  markGraphicJobFailure,
  regeneratePostWithAI,
  rewritePostCaptionWithAI,
  runGenerationJob,
  runGraphicJob,
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
  META_WEBHOOK_VERIFY_TOKEN?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_REDIRECT_URI?: string;
  LINKEDIN_ORGANIZATION_SCOPES?: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  TIKTOK_REDIRECT_URI?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_REDIRECT_URI?: string;
}

type PublishMessage = PublishQueueMessage;

type GenerationMessage = {
  kind: "generate";
  jobId: string;
};

type GraphicMessage = {
  kind: "graphic";
  graphicJobId: string;
};

type JobMessage = PublishMessage | GenerationMessage | GraphicMessage;

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
  const allowed = !origin || sameOrigin || configured.has(origin) || (isLocal && env.ENVIRONMENT !== "production");
  return {
    allowed,
    headers: {
      "access-control-allow-origin": origin && allowed ? origin : "",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,x-client-id,x-file-name,x-image-width,x-image-height,x-derivative-kind",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  };
}

async function sha256HexBytes(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function response(request: Request, env: Env, body: unknown, init: ResponseInit = {}) {
  const policy = cors(request, env);
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
  return Response.json(body, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "x-frame-options": "DENY",
      "x-request-id": requestId,
      ...policy.headers,
      ...init.headers,
    },
  });
}

function bulkPostIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.trim().length > 0))].slice(0, 100);
}

function postSelect(where = "") {
  return `SELECT
    p.*,
    c.name AS client_name,
    COALESCE(bp.primary_color, '#A56CFF') AS client_color,
    sa.account_name AS social_account_name,
    NULL AS image_url
    FROM posts p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN brand_profiles bp ON bp.client_id = p.client_id
    LEFT JOIN social_accounts sa ON sa.id = p.social_account_id
    ${where}`;
}

async function getPost(env: Env, postId: string) {
  return env.DB.prepare(postSelect("WHERE p.id = ?")).bind(postId).first<any>();
}

async function signPostMedia(
  env: Env,
  requestUrl: string,
  userId: string,
  row: any
) {
  if (row?.graphic_key) {
    row.image_url = await issuePostMediaUrl(
      env,
      requestUrl,
      userId,
      row.id,
      row.graphic_key
    );
  } else {
    row.image_url = null;
  }
  return row;
}

async function signPostRows(
  env: Env,
  requestUrl: string,
  userId: string,
  rows: any[]
) {
  return Promise.all(
    rows.map((row) => signPostMedia(env, requestUrl, userId, row))
  );
}

async function authorize(
  env: Env,
  user: SessionUser,
  permission: Permission,
  clientId?: string | null
) {
  if (!hasPermission(user, permission)) {
    return "You do not have permission to perform this action.";
  }
  if (clientId && !(await hasClientAccess(env.DB, user, clientId))) {
    return "You do not have access to this client.";
  }
  return null;
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
      const health = await readiness(env);
      return response(
        request,
        env,
        {
          ok: health.ok,
          service: health.service,
          environment: health.environment,
          checks: health.checks.map((check) => ({ name: check.name, ok: check.ok })),
          timestamp: health.timestamp,
        },
        { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } }
      );
    }

    if (url.pathname === "/v1/social/webhooks/meta") {
      return handleMetaWebhook(env, request, url);
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

    const signedMediaMatch = url.pathname.match(/^\/v1\/public\/media\/([^/]+)$/);
    if (signedMediaMatch && request.method === "GET") {
      const row = await resolveMediaToken(env, signedMediaMatch[1]);
      if (!row || row.expires_at <= Date.now()) {
        return response(request, env, { error: "Media link is invalid or expired." }, { status: 404 });
      }
      const object = await env.MEDIA.get(row.r2_key);
      if (!object) {
        return response(request, env, { error: "Media not found." }, { status: 404 });
      }
      return new Response(object.body, {
        headers: {
          "content-type": object.httpMetadata?.contentType || "image/jpeg",
          "cache-control": "private, max-age=300",
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

    if (
      request.method === "POST" &&
      /^\/v1\/public\/review\/[^/]+\/(edit|reject|regenerate|approve)$/.test(url.pathname)
    ) {
      const tokenPart = url.pathname.split("/")[4] || "unknown";
      const tokenHash = await hashSecret(tokenPart, env.AUTH_PEPPER || "");
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const limit = await enforceRateLimit(env, `review:${tokenHash}:${ip}`, 30, 15 * 60 * 1000);
      if (!limit.allowed) {
        return response(
          request,
          env,
          { error: "Too many review actions. Please wait and try again." },
          { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
        );
      }
    }

    const publicEditMatch = url.pathname.match(/^\/v1\/public\/review\/([^/]+)\/edit$/);
    if (publicEditMatch && request.method === "POST") {
      const tokenHash = await hashReviewToken(publicEditMatch[1], env);
      const row = await env.DB.prepare(
        `SELECT rt.post_id, rt.expires_at, p.status
         FROM review_tokens rt
         JOIN posts p ON p.id = rt.post_id
         WHERE rt.token_hash = ?`
      ).bind(tokenHash).first<any>();

      if (!row || row.expires_at <= Date.now()) {
        return response(request, env, { error: "This review link is invalid or expired." }, { status: 404 });
      }
      if (!["awaiting_approval","edit_requested"].includes(row.status)) {
        return response(request, env, { error: "This post is no longer editable from review." }, { status: 409 });
      }

      const payload = await request.json<{
        headline?: string;
        caption?: string;
        comment?: string;
      }>().catch(() => ({} as any));

      const headline = payload.headline?.trim().slice(0, 300);
      const caption = payload.caption?.trim().slice(0, 5000);
      const comment = payload.comment?.trim().slice(0, 2000);

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE posts SET
           headline = COALESCE(NULLIF(?, ''), headline),
           title = COALESCE(NULLIF(?, ''), title),
           caption = COALESCE(NULLIF(?, ''), caption),
           reviewer_comment = COALESCE(NULLIF(?, ''), reviewer_comment),
           status = 'awaiting_approval',
           updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(headline || null, headline || null, caption || null, comment || null, row.post_id),
        ...(comment ? [
          env.DB.prepare(
            `INSERT INTO review_comments
             (id,post_id,public_reviewer,comment)
             VALUES (?, ?, 1, ?)`
          ).bind(crypto.randomUUID(), row.post_id, comment)
        ] : []),
      ]);

      return response(request, env, { ok: true, postId: row.post_id });
    }

    const publicRejectMatch = url.pathname.match(/^\/v1\/public\/review\/([^/]+)\/reject$/);
    if (publicRejectMatch && request.method === "POST") {
      const tokenHash = await hashReviewToken(publicRejectMatch[1], env);
      const row = await env.DB.prepare(
        `SELECT rt.post_id, rt.expires_at, p.status
         FROM review_tokens rt
         JOIN posts p ON p.id = rt.post_id
         WHERE rt.token_hash = ?`
      ).bind(tokenHash).first<any>();

      if (!row || row.expires_at <= Date.now()) {
        return response(request, env, { error: "This review link is invalid or expired." }, { status: 404 });
      }
      if (!["awaiting_approval","edit_requested"].includes(row.status)) {
        return response(request, env, { error: "This post is no longer awaiting review." }, { status: 409 });
      }

      const payload = await request.json<{ reason?: string }>().catch(() => ({} as any));
      const reason = payload.reason?.trim().slice(0, 2000) || "Changes requested.";
      const now = new Date().toISOString();

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE posts SET
           status='edit_requested',
           rejected_at=?,
           rejection_reason=?,
           reviewer_comment=?,
           updated_at=?
           WHERE id=?`
        ).bind(now, reason, reason, now, row.post_id),
        env.DB.prepare(
          `INSERT INTO review_comments
           (id,post_id,public_reviewer,comment)
           VALUES (?, ?, 1, ?)`
        ).bind(crypto.randomUUID(), row.post_id, reason),
        env.DB.prepare(
          `INSERT INTO approvals
           (id,post_id,decision,previous_status)
           VALUES (?, ?, 'rejected_via_review_link', ?)`
        ).bind(crypto.randomUUID(), row.post_id, row.status),
      ]);

      return response(request, env, {
        ok: true,
        postId: row.post_id,
        status: "edit_requested",
      });
    }

    const publicRegenerateMatch = url.pathname.match(/^\/v1\/public\/review\/([^/]+)\/regenerate$/);
    if (publicRegenerateMatch && request.method === "POST") {
      const tokenHash = await hashReviewToken(publicRegenerateMatch[1], env);
      const row = await env.DB.prepare(
        `SELECT rt.post_id, rt.expires_at, p.status
         FROM review_tokens rt
         JOIN posts p ON p.id = rt.post_id
         WHERE rt.token_hash = ?`
      ).bind(tokenHash).first<any>();

      if (!row || row.expires_at <= Date.now()) {
        return response(request, env, { error: "This review link is invalid or expired." }, { status: 404 });
      }
      if (!["awaiting_approval","edit_requested"].includes(row.status)) {
        return response(request, env, { error: "This post cannot be regenerated from review." }, { status: 409 });
      }

      const payload = await request.json<{ instruction?: string }>().catch(() => ({} as any));
      const instruction = payload.instruction?.trim().slice(0, 2000);

      try {
        await env.DB.prepare(
          "UPDATE posts SET status='regenerating',updated_at=CURRENT_TIMESTAMP WHERE id=?"
        ).bind(row.post_id).run();

        const data = await regeneratePostWithAI(env, row.post_id, instruction);
        await env.DB.prepare(
          `UPDATE posts SET
           status='awaiting_approval',
           rejected_at=NULL,
           rejection_reason=NULL,
           updated_at=CURRENT_TIMESTAMP
           WHERE id=?`
        ).bind(row.post_id).run();

        return response(request, env, { ok: true, data });
      } catch (error) {
        await env.DB.prepare(
          "UPDATE posts SET status='edit_requested',updated_at=CURRENT_TIMESTAMP WHERE id=?"
        ).bind(row.post_id).run();

        return response(
          request,
          env,
          { error: error instanceof Error ? error.message : "Unable to regenerate this post." },
          { status: 502 }
        );
      }
    }

    const publicApproveMatch = url.pathname.match(/^\/v1\/public\/review\/([^/]+)\/approve$/);
    if (publicApproveMatch && request.method === "POST") {
      const tokenHash = await hashReviewToken(publicApproveMatch[1], env);
      const row = await env.DB.prepare(
        `SELECT rt.id AS review_token_id, rt.post_id, rt.expires_at, rt.used_at,
                p.status, p.client_id, p.platform, p.social_account_id, p.suggested_publish_at
         FROM review_tokens rt
         JOIN posts p ON p.id = rt.post_id
         WHERE rt.token_hash = ?`
      ).bind(tokenHash).first<any>();

      if (!row || row.expires_at <= Date.now() || row.used_at) {
        return response(request, env, { error: "This review link is invalid, expired, or already used." }, { status: 409 });
      }
      if (row.status !== "awaiting_approval") {
        return response(
          request,
          env,
          { error: "This post is no longer awaiting approval." },
          { status: 409 }
        );
      }
      if (!row.suggested_publish_at) {
        return response(request, env, { error: "This post does not have a proposed publishing slot." }, { status: 409 });
      }

      const destination = await ensurePostSocialDestination(env, {
        id: row.post_id,
        client_id: row.client_id,
        platform: row.platform,
        social_account_id: row.social_account_id,
      });
      if (!destination) {
        return response(
          request,
          env,
          { error: `Connect or choose a ${row.platform} publishing account before approval.` },
          { status: 409 }
        );
      }

      const now = new Date().toISOString();
      const scheduledAt = await findNextAvailableSlot(
        env,
        row.client_id,
        row.suggested_publish_at,
        row.post_id
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

    if (request.method === "GET" && url.pathname === "/v1/auth/google/start") {
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const limit = await enforceRateLimit(env, `google-auth:${ip}`, 30, 15 * 60 * 1000);
      if (!limit.allowed) {
        return response(
          request,
          env,
          { error: "Too many sign-in attempts. Please wait and try again." },
          { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
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
      const operations = await handleOperationsRoute(request, url, env, sessionUser);
      if (operations) {
        return response(
          request,
          env,
          operations.body,
          operations.status ? { status: operations.status } : {}
        );
      }

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
      const resource = await env.DB.prepare(
        `SELECT client_id FROM assets WHERE r2_key = ?
         UNION SELECT a.client_id FROM asset_derivatives d JOIN assets a ON a.id = d.asset_id WHERE d.r2_key = ?
         UNION SELECT client_id FROM posts WHERE graphic_key = ?
         UNION SELECT p.client_id FROM creative_variants v JOIN posts p ON p.id = v.post_id WHERE v.r2_key = ?`
      ).bind(key, key, key, key).all<{ client_id: string }>();
      let allowed = false;
      for (const row of resource.results) {
        if (await hasClientAccess(env.DB, sessionUser!, row.client_id)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) return response(request, env, { error: "Media not found." }, { status: 404 });
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

    const brandAssetsMatch = url.pathname.match(/^\/v1\/clients\/([^/]+)\/brand-assets$/);
    if (brandAssetsMatch && request.method === "GET") {
      const denied = await authorize(env, sessionUser!, "read", brandAssetsMatch[1]);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const rows = await env.DB.prepare(
        `SELECT ba.id, ba.role, ba.label, ba.created_at,
                a.id AS asset_id, a.filename, a.content_type, a.size_bytes
         FROM brand_assets ba
         JOIN assets a ON a.id = ba.asset_id
         WHERE ba.client_id = ?
         ORDER BY ba.created_at DESC`
      ).bind(brandAssetsMatch[1]).all<any>();

      return response(request, env, { data: rows.results });
    }

    if (brandAssetsMatch && request.method === "POST") {
      const denied = await authorize(env, sessionUser!, "brand_manage", brandAssetsMatch[1]);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const payload = await request.json<{ assetId?: string; role?: string; label?: string }>()
        .catch(() => ({} as any));
      if (!payload.assetId) {
        return response(request, env, { error: "assetId is required." }, { status: 400 });
      }

      const asset = await env.DB.prepare(
        "SELECT id FROM assets WHERE id = ? AND client_id = ?"
      ).bind(payload.assetId, brandAssetsMatch[1]).first();
      if (!asset) return response(request, env, { error: "Brand asset not found." }, { status: 404 });

      const role = (payload.role || "reference").trim().toLowerCase();
      if (!["logo","alternate_logo","reference","approved_image"].includes(role)) {
        return response(request, env, { error: "Invalid brand asset role." }, { status: 400 });
      }

      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO brand_assets
         (id, client_id, asset_id, role, label)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(id, brandAssetsMatch[1], payload.assetId, role, payload.label?.trim() || null).run();

      if (role === "logo" || role === "alternate_logo") {
        const column = role === "logo" ? "logo_asset_id" : "alternate_logo_asset_id";
        await env.DB.prepare(
          `UPDATE brand_profiles SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ?`
        ).bind(payload.assetId, brandAssetsMatch[1]).run();
      }

      return response(request, env, { ok: true, id });
    }

    const brandMatch = url.pathname.match(/^\/v1\/clients\/([^/]+)\/brand$/);
    if (brandMatch && request.method === "GET") {
      const denied = await authorize(env, sessionUser!, "read", brandMatch[1]);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const row = await env.DB.prepare(
        `SELECT c.id AS client_id, c.name, c.timezone,
                bp.id, bp.voice, bp.audience, bp.primary_color, bp.secondary_color,
                bp.website, bp.social_handles, bp.restricted_words, bp.tagline,
                bp.preferred_ctas, bp.imagery_preferences, bp.posting_rules,
                bp.fonts, bp.brand_examples, bp.prohibited_visual_styles,
                bp.competitor_references, bp.brand_vocabulary, bp.hashtag_policy,
                bp.target_locations, bp.platform_rules, bp.logo_asset_id,
                bp.alternate_logo_asset_id
         FROM clients c
         LEFT JOIN brand_profiles bp ON bp.client_id = c.id
         WHERE c.id = ?`
      ).bind(brandMatch[1]).first();
      if (!row) return response(request, env, { error: "Client not found" }, { status: 404 });
      return response(request, env, { data: row });
    }

    if (brandMatch && request.method === "POST") {
      const denied = await authorize(env, sessionUser!, "brand_manage", brandMatch[1]);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

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
          imagery_preferences, posting_rules, fonts, brand_examples,
          prohibited_visual_styles, competitor_references, brand_vocabulary,
          hashtag_policy, target_locations, platform_rules, logo_asset_id,
          alternate_logo_asset_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
           fonts = excluded.fonts,
           brand_examples = excluded.brand_examples,
           prohibited_visual_styles = excluded.prohibited_visual_styles,
           competitor_references = excluded.competitor_references,
           brand_vocabulary = excluded.brand_vocabulary,
           hashtag_policy = excluded.hashtag_policy,
           target_locations = excluded.target_locations,
           platform_rules = excluded.platform_rules,
           logo_asset_id = excluded.logo_asset_id,
           alternate_logo_asset_id = excluded.alternate_logo_asset_id,
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
        payload.postingRules || null,
        payload.fonts || null,
        payload.brandExamples || null,
        payload.prohibitedVisualStyles || null,
        payload.competitorReferences || null,
        payload.brandVocabulary || null,
        payload.hashtagPolicy || null,
        payload.targetLocations || null,
        payload.platformRules || null,
        payload.logoAssetId || null,
        payload.alternateLogoAssetId || null
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

      const denied = await authorize(env, sessionUser!, "generate", payload.clientId);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

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

    if (request.method === "GET" && url.pathname === "/v1/dashboard") {
      const denied = await authorize(env, sessionUser!, "read");
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const allowedClients = await accessibleClientIds(env.DB, sessionUser!);
      const whereClients = allowedClients === null
        ? ""
        : allowedClients.length
          ? ` AND p.client_id IN (${allowedClients.map(() => "?").join(",")})`
          : " AND 1 = 0";

      const bindings = allowedClients === null ? [] : allowedClients;
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

      const stats = await env.DB.prepare(
        `SELECT
          SUM(CASE WHEN p.status = 'awaiting_approval' THEN 1 ELSE 0 END) AS needs_review,
          SUM(CASE WHEN p.status IN ('calendar_scheduled','pre_publish','rescheduled','publish_queued') THEN 1 ELSE 0 END) AS scheduled,
          SUM(CASE WHEN p.scheduled_publish_at >= ? AND p.scheduled_publish_at < ? AND p.status NOT IN ('canceled','failed','published') THEN 1 ELSE 0 END) AS publishing_today,
          SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM posts p
         WHERE 1 = 1 ${whereClients}`
      ).bind(todayStart.toISOString(), tomorrow.toISOString(), ...bindings).first<any>();

      const nextStatement = env.DB.prepare(
        `SELECT p.*, c.name AS client_name, sa.account_name AS social_account_name
         FROM posts p
         JOIN clients c ON c.id = p.client_id
         LEFT JOIN social_accounts sa ON sa.id = p.social_account_id
         WHERE p.scheduled_publish_at IS NOT NULL
           AND p.scheduled_publish_at >= ?
           AND p.status IN ('calendar_scheduled','pre_publish','rescheduled','publish_queued')
           ${whereClients}
         ORDER BY p.scheduled_publish_at ASC
         LIMIT 1`
      );
      const next = bindings.length
        ? await nextStatement.bind(now.toISOString(), ...bindings).first<any>()
        : await nextStatement.bind(now.toISOString()).first<any>();

      return response(request, env, {
        data: {
          needsReview: Number(stats?.needs_review || 0),
          scheduled: Number(stats?.scheduled || 0),
          publishingToday: Number(stats?.publishing_today || 0),
          failed: Number(stats?.failed || 0),
          nextPost: next || null,
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/clients") {
      const denied = await authorize(env, sessionUser!, "read");
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const allowedClients = await accessibleClientIds(env.DB, sessionUser!);
      const includeArchived = url.searchParams.get("includeArchived") === "1";
      const result = await env.DB.prepare(
        `SELECT c.id, c.name, c.timezone, c.status, c.archived_at,
                COALESCE(bp.primary_color, '#A56CFF') AS color
         FROM clients c
         LEFT JOIN brand_profiles bp ON bp.client_id = c.id
         WHERE (? = 1 OR c.status = 'active')
         ORDER BY c.name`
      ).bind(includeArchived ? 1 : 0).all<any>();

      return response(request, env, {
        data: allowedClients === null
          ? result.results
          : result.results.filter((row) => allowedClients.includes(row.id)),
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/clients") {
      const denied = await authorize(env, sessionUser!, "client_manage");
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const payload = await request.json<{ name?: string; timezone?: string }>().catch(() => ({} as any));
      const name = payload.name?.trim();
      if (!name) return response(request, env, { error: "Client name is required." }, { status: 400 });

      const id = crypto.randomUUID();
      const timezone = payload.timezone?.trim() || "America/Indiana/Indianapolis";
      const statements = [
        env.DB.prepare(
          "INSERT INTO clients (id, name, timezone, status, created_at, updated_at) VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ).bind(id, name, timezone),
        env.DB.prepare(
          "INSERT INTO brand_profiles (id, client_id, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ).bind(crypto.randomUUID(), id),
      ];
      if (sessionUser!.role !== "owner") {
        statements.push(
          env.DB.prepare(
            `INSERT INTO user_client_access (user_id,client_id,access_role)
             VALUES (?,?,?)`
          ).bind(sessionUser!.id,id,sessionUser!.role)
        );
      }
      await env.DB.batch(statements);

      return response(request, env, { ok: true, id, name, timezone }, { status: 201 });
    }

    const clientMatch = url.pathname.match(/^\/v1\/clients\/([^/]+)$/);
    if (clientMatch && request.method === "POST") {
      const denied = await authorize(env, sessionUser!, "client_manage", clientMatch[1]);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const payload = await request.json<{ name?: string; timezone?: string }>().catch(() => ({} as any));
      const current = await env.DB.prepare("SELECT id FROM clients WHERE id = ?")
        .bind(clientMatch[1]).first();
      if (!current) return response(request, env, { error: "Client not found." }, { status: 404 });

      await env.DB.prepare(
        `UPDATE clients SET
         name = COALESCE(NULLIF(?, ''), name),
         timezone = COALESCE(NULLIF(?, ''), timezone),
         updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(payload.name || null, payload.timezone || null, clientMatch[1]).run();

      return response(request, env, { ok: true });
    }

    const archiveClientMatch = url.pathname.match(/^\/v1\/clients\/([^/]+)\/archive$/);
    if (archiveClientMatch && request.method === "POST") {
      const denied = await authorize(env, sessionUser!, "client_manage", archiveClientMatch[1]);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE clients SET status = 'archived', archived_at = ?, updated_at = ?
         WHERE id = ?`
      ).bind(now, now, archiveClientMatch[1]).run();

      return response(request, env, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/v1/assets") {
      const clientId = request.headers.get("x-client-id")?.trim();
      const filename = request.headers.get("x-file-name")?.trim() || "upload.jpg";
      const contentType = request.headers.get("content-type") || "application/octet-stream";
      const declaredSize = Number(request.headers.get("content-length") || 0);
      const width = Number(request.headers.get("x-image-width") || 0) || null;
      const height = Number(request.headers.get("x-image-height") || 0) || null;

      if (!clientId) return response(request, env, { error: "x-client-id is required" }, { status: 400 });

      const denied = await authorize(env, sessionUser!, "upload", clientId);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      if (!contentType.startsWith("image/")) {
        return response(request, env, { error: "Only image uploads are supported." }, { status: 415 });
      }
      if (declaredSize > MAX_IMAGE_BYTES) {
        return response(request, env, { error: "Image exceeds the 20 MB upload limit." }, { status: 413 });
      }

      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return response(request, env, { error: "Image exceeds the 20 MB upload limit." }, { status: 413 });
      }

      const assetId = crypto.randomUUID();
      const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "jpg";
      const key = `originals/${clientId}/${assetId}.${extension}`;
      const hash = await sha256HexBytes(bytes);

      await env.MEDIA.put(key, bytes, {
        httpMetadata: { contentType },
        customMetadata: { sha256: hash, originalFilename: filename },
      });

      await env.DB.prepare(
        `INSERT INTO assets
         (id, client_id, r2_key, filename, content_type, size_bytes, width, height, source, status, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'upload', 'uploaded', ?)`
      ).bind(
        assetId,
        clientId,
        key,
        filename,
        contentType,
        bytes.byteLength,
        width,
        height,
        hash
      ).run();

      return response(request, env, {
        data: {
          id: assetId,
          clientId,
          filename,
          contentType,
          status: "uploaded",
          url: `/v1/assets/${assetId}`,
          createdAt: new Date().toISOString(),
        },
      }, { status: 201 });
    }

    const derivativeMatch = url.pathname.match(/^\/v1\/assets\/([^/]+)\/derivative$/);
    if (derivativeMatch && request.method === "POST") {
      const clientId = request.headers.get("x-client-id")?.trim();
      const kind = request.headers.get("x-derivative-kind")?.trim() || "analysis";
      const filename = request.headers.get("x-file-name")?.trim() || `${kind}.jpg`;
      const contentType = request.headers.get("content-type") || "image/jpeg";
      const width = Number(request.headers.get("x-image-width") || 0) || null;
      const height = Number(request.headers.get("x-image-height") || 0) || null;

      if (!clientId) return response(request, env, { error: "x-client-id is required" }, { status: 400 });
      if (!["analysis","thumbnail"].includes(kind)) {
        return response(request, env, { error: "Invalid derivative kind." }, { status: 400 });
      }

      const denied = await authorize(env, sessionUser!, "upload", clientId);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const asset = await env.DB.prepare(
        "SELECT id FROM assets WHERE id = ? AND client_id = ?"
      ).bind(derivativeMatch[1], clientId).first();
      if (!asset) return response(request, env, { error: "Asset not found." }, { status: 404 });

      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 8 * 1024 * 1024) {
        return response(request, env, { error: "Derivative exceeds the 8 MB limit." }, { status: 413 });
      }

      const hash = await sha256HexBytes(bytes);
      const id = crypto.randomUUID();
      const key = `derivatives/${clientId}/${derivativeMatch[1]}/${kind}.jpg`;

      await env.MEDIA.put(key, bytes, {
        httpMetadata: { contentType },
        customMetadata: { sha256: hash, derivativeKind: kind, filename },
      });

      await env.DB.prepare(
        `INSERT INTO asset_derivatives
         (id, asset_id, kind, r2_key, content_type, size_bytes, width, height, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id, kind) DO UPDATE SET
           r2_key = excluded.r2_key,
           content_type = excluded.content_type,
           size_bytes = excluded.size_bytes,
           width = excluded.width,
           height = excluded.height,
           sha256 = excluded.sha256,
           created_at = CURRENT_TIMESTAMP`
      ).bind(
        id,
        derivativeMatch[1],
        kind,
        key,
        contentType,
        bytes.byteLength,
        width,
        height,
        hash
      ).run();

      return response(request, env, { ok: true, id });
    }

    const assetMatch = url.pathname.match(/^\/v1\/assets\/([^/]+)$/);
    if (request.method === "GET" && assetMatch) {
      const row = await env.DB.prepare(
        "SELECT client_id, r2_key, content_type FROM assets WHERE id = ?"
      ).bind(assetMatch[1]).first<{ client_id: string; r2_key: string; content_type: string }>();
      if (!row) return response(request, env, { error: "Asset not found" }, { status: 404 });

      const denied = await authorize(env, sessionUser!, "read", row.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

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
      const denied = await authorize(env, sessionUser!, "read");
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const allowedClients = await accessibleClientIds(env.DB, sessionUser!);
      const result = await env.DB.prepare(
        postSelect("WHERE p.status = ? ORDER BY p.suggested_publish_at ASC")
      ).bind("awaiting_approval").all<any>();

      const visible = allowedClients === null
        ? result.results
        : result.results.filter((row) => allowedClients.includes(row.client_id));

      return response(request, env, {
        data: await signPostRows(env, request.url, sessionUser!.id, visible),
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/posts/calendar") {
      const denied = await authorize(env, sessionUser!, "read");
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!from || !to) {
        return response(request, env, { error: "from and to are required" }, { status: 400 });
      }

      const allowedClients = await accessibleClientIds(env.DB, sessionUser!);
      const result = await env.DB.prepare(
        postSelect(
          `WHERE p.scheduled_publish_at IS NOT NULL
           AND p.scheduled_publish_at >= ?
           AND p.scheduled_publish_at < ?
           AND p.status IN ('calendar_scheduled','pre_publish','rescheduled','publish_queued','publishing','provider_processing','published','failed')
           ORDER BY p.scheduled_publish_at ASC`
        )
      ).bind(from, to).all<any>();

      const visible = allowedClients === null
        ? result.results
        : result.results.filter((row) => allowedClients.includes(row.client_id));

      return response(request, env, {
        data: await signPostRows(env, request.url, sessionUser!.id, visible),
      });
    }

    const creativeMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/creative$/);
    if (creativeMatch && request.method === "GET") {
      const post = await env.DB.prepare(
        "SELECT id, client_id FROM posts WHERE id = ?"
      ).bind(creativeMatch[1]).first<{ id: string; client_id: string }>();
      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });

      const denied = await authorize(env, sessionUser!, "read", post.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      const variants = await env.DB.prepare(
        `SELECT id,platform,variant_key,aspect_ratio,width,height,r2_key,
                content_type,is_primary,composition_json,model,response_id,created_at
         FROM creative_variants
         WHERE post_id = ?
         ORDER BY is_primary DESC, created_at DESC`
      ).bind(post.id).all<any>();

      const signedVariants = await Promise.all(
        variants.results.map(async (variant) => ({
          ...variant,
          url: await issuePostMediaUrl(
            env,
            request.url,
            sessionUser!.id,
            post.id,
            variant.r2_key
          ),
          composition: variant.composition_json
            ? JSON.parse(variant.composition_json)
            : null,
        }))
      );

      const score = await env.DB.prepare(
        `SELECT overall,brand_match,readability,platform_fit,cta_strength,
                composition,caption_quality,compliance,rationale,model,response_id,updated_at
         FROM sparq_scores WHERE post_id = ?`
      ).bind(post.id).first<any>();

      return response(request, env, {
        data: { variants: signedVariants, score: score || null },
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/posts/bulk/approve") {
      const payload = await request.json<{ postIds?: string[] }>().catch(() => ({} as any));
      const postIds = bulkPostIds(payload.postIds);
      if (!postIds.length) {
        return response(request, env, { error: "postIds are required." }, { status: 400 });
      }

      const results = [];
      for (const postId of postIds) {
        const post = await env.DB.prepare(
          "SELECT id,status,client_id,platform,social_account_id,suggested_publish_at FROM posts WHERE id=?"
        ).bind(postId).first<any>();

        if (!post) {
          results.push({ postId, ok: false, error: "Post not found." });
          continue;
        }

        const denied = await authorize(env, sessionUser!, "review", post.client_id);
        if (denied) {
          results.push({ postId, ok: false, error: denied });
          continue;
        }
        if (post.status !== "awaiting_approval" || !post.suggested_publish_at) {
          results.push({ postId, ok: false, error: "Post is not ready for approval." });
          continue;
        }

        const destination = await ensurePostSocialDestination(env, post);
        if (!destination) {
          results.push({ postId, ok: false, error: "Publishing account required." });
          continue;
        }

        const scheduledAt = await findNextAvailableSlot(
          env,
          post.client_id,
          post.suggested_publish_at,
          postId
        );
        const now = new Date().toISOString();

        await env.DB.batch([
          env.DB.prepare(
            `UPDATE posts SET
             status='calendar_scheduled',
             approved_at=?,
             calendar_added_at=?,
             scheduled_publish_at=?,
             updated_at=?
             WHERE id=?`
          ).bind(now, now, scheduledAt, now, postId),
          env.DB.prepare(
            `INSERT INTO approvals
             (id,post_id,decision,previous_status)
             VALUES (?,?,'approved_bulk',?)`
          ).bind(crypto.randomUUID(), postId, post.status),
        ]);

        results.push({ postId, ok: true, scheduledPublishAt: scheduledAt });
      }

      return response(request, env, { ok: true, results });
    }

    if (request.method === "POST" && url.pathname === "/v1/posts/bulk/reject") {
      const payload = await request.json<{ postIds?: string[]; reason?: string }>().catch(() => ({} as any));
      const postIds = bulkPostIds(payload.postIds);
      const reason = payload.reason?.trim().slice(0, 2000) || "Changes requested.";
      if (!postIds.length) {
        return response(request, env, { error: "postIds are required." }, { status: 400 });
      }

      const results = [];
      for (const postId of postIds) {
        const post = await env.DB.prepare(
          "SELECT client_id,status FROM posts WHERE id=?"
        ).bind(postId).first<any>();

        if (!post) {
          results.push({ postId, ok: false, error: "Post not found." });
          continue;
        }

        const denied = await authorize(env, sessionUser!, "review", post.client_id);
        if (denied) {
          results.push({ postId, ok: false, error: denied });
          continue;
        }
        if (!["awaiting_approval","edit_requested"].includes(post.status)) {
          results.push({ postId, ok: false, error: "Post is not in review." });
          continue;
        }

        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE posts SET
             status='edit_requested',
             rejected_at=?,
             rejection_reason=?,
             reviewer_comment=?,
             updated_at=?
             WHERE id=?`
          ).bind(now, reason, reason, now, postId),
          env.DB.prepare(
            `INSERT INTO review_comments
             (id,post_id,user_id,comment)
             VALUES (?,?,?,?)`
          ).bind(crypto.randomUUID(), postId, sessionUser!.id, reason),
        ]);

        results.push({ postId, ok: true });
      }

      return response(request, env, { ok: true, results });
    }

    if (request.method === "POST" && url.pathname === "/v1/posts/bulk/shift") {
      const payload = await request.json<{ postIds?: string[]; shiftMinutes?: number }>().catch(() => ({} as any));
      const postIds = bulkPostIds(payload.postIds);
      const shiftMinutes = Number(payload.shiftMinutes || 0);

      if (!postIds.length || !Number.isFinite(shiftMinutes) || shiftMinutes === 0) {
        return response(request, env, { error: "postIds and non-zero shiftMinutes are required." }, { status: 400 });
      }

      const results = [];
      for (const postId of postIds) {
        const post = await env.DB.prepare(
          "SELECT client_id,status,scheduled_publish_at FROM posts WHERE id=?"
        ).bind(postId).first<any>();

        if (!post) {
          results.push({ postId, ok: false, error: "Post not found." });
          continue;
        }

        const denied = await authorize(env, sessionUser!, "calendar_manage", post.client_id);
        if (denied) {
          results.push({ postId, ok: false, error: denied });
          continue;
        }
        if (!post.scheduled_publish_at || !["calendar_scheduled","pre_publish","rescheduled","paused"].includes(post.status)) {
          results.push({ postId, ok: false, error: "Post cannot be shifted." });
          continue;
        }

        const requested = new Date(
          Date.parse(post.scheduled_publish_at) + shiftMinutes * 60 * 1000
        ).toISOString();

        const scheduledAt = await findNextAvailableSlot(
          env,
          post.client_id,
          requested,
          postId
        );
        const now = new Date().toISOString();

        await env.DB.batch([
          env.DB.prepare(
            `UPDATE publish_jobs SET
             status='canceled',completed_at=?,updated_at=?
             WHERE post_id=? AND status IN ('queued','retrying')`
          ).bind(now, now, postId),
          env.DB.prepare(
            `UPDATE posts SET
             scheduled_publish_at=?,
             prepublish_response='reschedule',
             prepublish_alert_at=NULL,
             publish_version=publish_version+1,
             status='rescheduled',
             updated_at=?
             WHERE id=?`
          ).bind(scheduledAt, now, postId),
        ]);

        results.push({ postId, ok: true, scheduledPublishAt: scheduledAt });
      }

      return response(request, env, { ok: true, results });
    }

    if (request.method === "POST" && url.pathname === "/v1/posts/bulk/pause") {
      const payload = await request.json<{ postIds?: string[] }>().catch(() => ({} as any));
      const postIds = bulkPostIds(payload.postIds);
      if (!postIds.length) {
        return response(request, env, { error: "postIds are required." }, { status: 400 });
      }

      const results = [];
      for (const postId of postIds) {
        const post = await env.DB.prepare(
          "SELECT client_id,status FROM posts WHERE id=?"
        ).bind(postId).first<any>();

        if (!post) {
          results.push({ postId, ok: false, error: "Post not found." });
          continue;
        }

        const denied = await authorize(env, sessionUser!, "calendar_manage", post.client_id);
        if (denied) {
          results.push({ postId, ok: false, error: denied });
          continue;
        }

        if (!["calendar_scheduled","pre_publish","rescheduled","publish_queued"].includes(post.status)) {
          results.push({ postId, ok: false, error: "Post cannot be paused." });
          continue;
        }

        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE publish_jobs SET
             status='canceled',completed_at=?,updated_at=?
             WHERE post_id=? AND status IN ('queued','retrying')`
          ).bind(now, now, postId),
          env.DB.prepare(
            `UPDATE posts SET
             status='paused',
             publish_version=publish_version+1,
             updated_at=?
             WHERE id=?`
          ).bind(now, postId),
        ]);

        results.push({ postId, ok: true });
      }

      return response(request, env, { ok: true, results });
    }

    const postMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)$/);
    if (request.method === "GET" && postMatch) {
      const post = await getPost(env, postMatch[1]);
      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });

      const denied = await authorize(env, sessionUser!, "read", post.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      return response(request, env, {
        data: await signPostMedia(env, request.url, sessionUser!.id, post),
      });
    }

    const editPostMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/edit$/);
    if (editPostMatch && request.method === "POST") {
      const post = await env.DB.prepare(
        "SELECT client_id,status FROM posts WHERE id=?"
      ).bind(editPostMatch[1]).first<any>();
      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });

      const denied = await authorize(env, sessionUser!, "review", post.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });
      if (!["awaiting_approval","edit_requested"].includes(post.status)) {
        return response(request, env, { error: "This post is not editable from review." }, { status: 409 });
      }

      const payload = await request.json<{ headline?: string; caption?: string; comment?: string }>()
        .catch(() => ({} as any));
      const headline = payload.headline?.trim().slice(0, 300);
      const caption = payload.caption?.trim().slice(0, 5000);
      const comment = payload.comment?.trim().slice(0, 2000);

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE posts SET
           headline=COALESCE(NULLIF(?,''),headline),
           title=COALESCE(NULLIF(?,''),title),
           caption=COALESCE(NULLIF(?,''),caption),
           reviewer_comment=COALESCE(NULLIF(?,''),reviewer_comment),
           status='awaiting_approval',
           updated_at=CURRENT_TIMESTAMP
           WHERE id=?`
        ).bind(headline||null,headline||null,caption||null,comment||null,editPostMatch[1]),
        ...(comment ? [
          env.DB.prepare(
            "INSERT INTO review_comments (id,post_id,user_id,comment) VALUES (?,?,?,?)"
          ).bind(crypto.randomUUID(),editPostMatch[1],sessionUser!.id,comment)
        ] : []),
      ]);

      await audit(env, editPostMatch[1], "post.edited_in_review");
      return response(request, env, { ok: true });
    }

    const rejectPostMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/reject$/);
    if (rejectPostMatch && request.method === "POST") {
      const post = await env.DB.prepare(
        "SELECT client_id,status FROM posts WHERE id=?"
      ).bind(rejectPostMatch[1]).first<any>();
      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });

      const denied = await authorize(env, sessionUser!, "review", post.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });
      if (!["awaiting_approval","edit_requested"].includes(post.status)) {
        return response(request, env, { error: "This post is not in review." }, { status: 409 });
      }

      const payload = await request.json<{ reason?: string }>().catch(() => ({} as any));
      const reason = payload.reason?.trim().slice(0,2000) || "Changes requested.";
      const now = new Date().toISOString();

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE posts SET
           status='edit_requested',
           rejected_at=?,
           rejection_reason=?,
           reviewer_comment=?,
           updated_at=?
           WHERE id=?`
        ).bind(now,reason,reason,now,rejectPostMatch[1]),
        env.DB.prepare(
          "INSERT INTO review_comments (id,post_id,user_id,comment) VALUES (?,?,?,?)"
        ).bind(crypto.randomUUID(),rejectPostMatch[1],sessionUser!.id,reason),
      ]);

      await audit(env, rejectPostMatch[1], "post.rejected", { reason });
      return response(request, env, { ok: true, status: "edit_requested" });
    }

    const approvalMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/approve$/);
    if (request.method === "POST" && approvalMatch) {
      const postId = approvalMatch[1];
      const now = new Date().toISOString();
      const post = await env.DB.prepare(
        "SELECT id, status, client_id, platform, social_account_id, suggested_publish_at FROM posts WHERE id = ?"
      ).bind(postId).first<any>();

      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });

      const denied = await authorize(env, sessionUser!, "review", post.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      if (post.status !== "awaiting_approval") {
        return response(
          request,
          env,
          { error: "This post is no longer awaiting approval." },
          { status: 409 }
        );
      }

      if (!post.suggested_publish_at) {
        return response(request, env, { error: "Post does not have a proposed publishing slot" }, { status: 409 });
      }

      const destination = await ensurePostSocialDestination(env, post);
      if (!destination) {
        return response(
          request,
          env,
          { error: `Connect or choose a ${post.platform} publishing account before approval.` },
          { status: 409 }
        );
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
      await audit(env, postId, "post.approved");

      return response(request, env, { ok: true, postId, status: "calendar_scheduled" });
    }

    const keepMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/keep-schedule$/);
    if (request.method === "POST" && keepMatch) {
      const postId = keepMatch[1];
      const post = await env.DB.prepare(
        "SELECT client_id, status FROM posts WHERE id = ?"
      ).bind(postId).first<{ client_id: string; status: string }>();
      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });

      const denied = await authorize(env, sessionUser!, "calendar_manage", post.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      if (!["calendar_scheduled","pre_publish","rescheduled","paused"].includes(post.status)) {
        return response(
          request,
          env,
          { error: "This post cannot keep a schedule from its current state." },
          { status: 409 }
        );
      }

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
      const payload = await request.json<{ scheduledPublishAt?: string }>().catch(() => ({} as any));
      if (!payload.scheduledPublishAt || Number.isNaN(Date.parse(payload.scheduledPublishAt))) {
        return response(request, env, { error: "A valid scheduledPublishAt value is required" }, { status: 400 });
      }

      const post = await env.DB.prepare(
        "SELECT client_id, status FROM posts WHERE id = ?"
      ).bind(postId).first<{ client_id: string; status: string }>();
      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });

      const denied = await authorize(env, sessionUser!, "calendar_manage", post.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      if (!["calendar_scheduled","pre_publish","rescheduled","paused"].includes(post.status)) {
        return response(
          request,
          env,
          { error: "This post cannot be rescheduled from its current state." },
          { status: 409 }
        );
      }

      const scheduledAt = await findNextAvailableSlot(
        env,
        post.client_id,
        payload.scheduledPublishAt,
        postId
      );

      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE publish_jobs SET
           status = 'canceled',
           completed_at = ?,
           updated_at = ?
           WHERE post_id = ? AND status IN ('queued','retrying')`
        ).bind(now, now, postId),
        env.DB.prepare(
          `UPDATE posts SET
           scheduled_publish_at = ?,
           prepublish_response = 'reschedule',
           prepublish_alert_at = NULL,
           publish_version = publish_version + 1,
           status = 'rescheduled',
           updated_at = ?
           WHERE id = ?`
        ).bind(scheduledAt, now, postId),
      ]);

      await audit(env, postId, "post.rescheduled", {
        requestedPublishAt: payload.scheduledPublishAt,
        scheduledPublishAt: scheduledAt,
      });
      return response(request, env, {
        ok: true,
        postId,
        status: "rescheduled",
        scheduledPublishAt: scheduledAt,
        adjusted: scheduledAt !== new Date(payload.scheduledPublishAt).toISOString(),
      });
    }

    const publishNowMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/publish-now$/);
    if (request.method === "POST" && publishNowMatch) {
      const postId = publishNowMatch[1];
      const post = await env.DB.prepare(
        "SELECT id, client_id, social_account_id, scheduled_publish_at, status FROM posts WHERE id = ?"
      ).bind(postId).first<any>();
      if (!post) return response(request, env, { error: "Post not found" }, { status: 404 });

      const denied = await authorize(env, sessionUser!, "publish", post.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });

      if (!["calendar_scheduled","pre_publish","rescheduled","paused","publish_queued"].includes(post.status)) {
        return response(
          request,
          env,
          { error: "This post cannot be published from its current state." },
          { status: 409 }
        );
      }

      if (!post.social_account_id) {
        return response(
          request,
          env,
          { error: "Assign a connected social account before publishing." },
          { status: 409 }
        );
      }

      const job = await ensurePublishJob(
        env,
        postId,
        post.scheduled_publish_at || new Date().toISOString()
      );

      await env.DB.prepare(
        `UPDATE posts SET
         prepublish_response = 'publish_now',
         status = CASE WHEN status = 'published' THEN status ELSE 'publish_queued' END,
         updated_at = ?
         WHERE id = ?`
      ).bind(new Date().toISOString(), postId).run();

      if (job.shouldEnqueue) {
        await env.PUBLISH_QUEUE.send({
          kind: "publish",
          publishJobId: job.jobId,
          postId,
          executionKey: job.executionKey,
        });
      }

      await audit(env, postId, "post.publish_now");
      return response(request, env, {
        ok: true,
        queued: job.shouldEnqueue,
        postId,
        publishJobId: job.jobId,
      });
    }


    const rewriteCaptionMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/ai-rewrite-caption$/);
    if (rewriteCaptionMatch && request.method === "POST") {
      const accessPost = await env.DB.prepare(
        "SELECT client_id FROM posts WHERE id = ?"
      ).bind(rewriteCaptionMatch[1]).first<{ client_id: string }>();
      if (!accessPost) return response(request, env, { error: "Post not found" }, { status: 404 });
      const denied = await authorize(env, sessionUser!, "ai_edit", accessPost.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });
      const payload = await request.json<{ instruction?: string }>().catch(() => ({} as any));
      const instruction = payload.instruction?.trim().slice(0, 2000);
      try {
        const data = await rewritePostCaptionWithAI(env, rewriteCaptionMatch[1], instruction);
        await audit(env, rewriteCaptionMatch[1], "post.ai_caption_rewritten", { instruction: instruction || null });
        return response(request, env, { ok: true, data });
      } catch (error) {
        return response(request, env, { error: error instanceof Error ? error.message : "Unable to rewrite caption." }, { status: 502 });
      }
    }

    const editImageMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/ai-edit-image$/);
    if (editImageMatch && request.method === "POST") {
      const accessPost = await env.DB.prepare(
        "SELECT client_id FROM posts WHERE id = ?"
      ).bind(editImageMatch[1]).first<{ client_id: string }>();
      if (!accessPost) return response(request, env, { error: "Post not found" }, { status: 404 });
      const denied = await authorize(env, sessionUser!, "ai_edit", accessPost.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });
      const payload = await request.json<{ instruction?: string }>().catch(() => ({} as any));
      const instruction = payload.instruction?.trim().slice(0, 2000) || "";
      if (!instruction) return response(request, env, { error: "instruction is required." }, { status: 400 });
      try {
        const data = await editPostGraphicWithAI(env, editImageMatch[1], instruction);
        await audit(env, editImageMatch[1], "post.ai_graphic_edited", { instruction });
        return response(request, env, { ok: true, data });
      } catch (error) {
        return response(request, env, { error: error instanceof Error ? error.message : "Unable to edit graphic." }, { status: 502 });
      }
    }

    const regenerateMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/ai-regenerate$/);
    if (regenerateMatch && request.method === "POST") {
      const accessPost = await env.DB.prepare(
        "SELECT client_id FROM posts WHERE id = ?"
      ).bind(regenerateMatch[1]).first<{ client_id: string }>();
      if (!accessPost) return response(request, env, { error: "Post not found" }, { status: 404 });
      const denied = await authorize(env, sessionUser!, "ai_edit", accessPost.client_id);
      if (denied) return response(request, env, { error: denied }, { status: 403 });
      const payload = await request.json<{ instruction?: string }>().catch(() => ({} as any));
      const instruction = payload.instruction?.trim().slice(0, 2000);
      try {
        const data = await regeneratePostWithAI(env, regenerateMatch[1], instruction);
        await audit(env, regenerateMatch[1], "post.ai_regenerated", { instruction: instruction || null });
        return response(request, env, { ok: true, data });
      } catch (error) {
        return response(request, env, { error: error instanceof Error ? error.message : "Unable to regenerate post." }, { status: 502 });
      }
    }

    return response(request, env, { error: "Not found" }, { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    try {
      await checkExpoPushReceipts(env);
    } catch (error) {
      await recordSystemEvent(env, {
        severity: "warning",
        category: "notifications",
        eventType: "push_receipt_check_failed",
        message: error instanceof Error ? error.message.slice(0, 1000) : "Push receipt check failed.",
      }).catch(() => undefined);
    }

    try {
      await recoverStaleWork(env);
    } catch (error) {
      await recordSystemEvent(env, {
        severity: "error",
        category: "recovery",
        eventType: "scheduled_recovery_failed",
        message: error instanceof Error ? error.message.slice(0, 1000) : "Scheduled recovery failed.",
      }).catch(() => undefined);
    }

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
      `SELECT p.id, p.prepublish_response,
              COALESCE(cs.no_response_policy, np.no_response_policy,
                       ws.default_no_response_policy, 'auto_publish') AS no_response_policy
       FROM posts p
       JOIN workspace_settings ws ON ws.id = 'default'
       LEFT JOIN client_settings cs ON cs.client_id = p.client_id
       LEFT JOIN users u ON u.role = 'owner'
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE p.status IN ('calendar_scheduled','pre_publish','rescheduled','publish_queued')
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

      const scheduled = await env.DB.prepare(
        "SELECT scheduled_publish_at FROM posts WHERE id = ?"
      ).bind(row.id).first<{ scheduled_publish_at: string | null }>();

      const job = await ensurePublishJob(
        env,
        row.id,
        scheduled?.scheduled_publish_at || nowIso
      );

      if (job.shouldEnqueue) {
        await env.DB.prepare(
          "UPDATE posts SET status = 'publish_queued', updated_at = ? WHERE id = ? AND status != 'published'"
        ).bind(nowIso, row.id).run();

        await env.PUBLISH_QUEUE.send({
          kind: "publish",
          publishJobId: job.jobId,
          postId: row.id,
          executionKey: job.executionKey,
        });
      }
    }

    try {
      const confirmations = await checkPendingPublishReceipts(env, 25);
      for (const confirmation of confirmations) {
        if (confirmation.status === "published" && confirmation.postId) {
          await notifyPostOwners(
            env,
            confirmation.postId,
            "published",
            "Post published",
            "BrandSparQ confirmed your post is live."
          );
        } else if (confirmation.status === "failed" && confirmation.postId) {
          await recordSystemEvent(env, {
            severity: "error",
            category: "publishing",
            eventType: "provider_confirmation_failed",
            entityType: "post",
            entityId: confirmation.postId,
            message: `Provider confirmation failed with status ${confirmation.providerStatus || "failed"}.`,
          }).catch(() => undefined);
          await notifyPostOwners(
            env,
            confirmation.postId,
            "publish_failed",
            "Post failed at the provider",
            `Provider status: ${confirmation.providerStatus || "failed"}`
          );
        }
      }
    } catch (error) {
      await recordSystemEvent(env, {
        severity: "warning",
        category: "publishing",
        eventType: "publish_receipt_check_failed",
        message: error instanceof Error ? error.message.slice(0, 1000) : "Provider receipt check failed.",
      }).catch(() => undefined);
    }

    const healthCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const healthAccounts = await env.DB.prepare(
      `SELECT id FROM social_accounts
       WHERE status='connected'
         AND (health_checked_at IS NULL OR health_checked_at < ?)
       ORDER BY COALESCE(health_checked_at, created_at) ASC
       LIMIT 10`
    ).bind(healthCutoff).all<{ id: string }>();

    for (const account of healthAccounts.results) {
      try {
        await verifySocialAccount(env, account.id);
      } catch (error) {
        await recordSystemEvent(env, {
          severity: "warning",
          category: "social",
          eventType: "social_health_check_failed",
          entityType: "social_account",
          entityId: account.id,
          message: error instanceof Error ? error.message.slice(0, 1000) : "Social health check failed.",
        }).catch(() => undefined);
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
        try {
          await syncAccountAnalytics(env, account.id);
        } catch (error) {
          await recordSystemEvent(env, {
            severity: "warning",
            category: "analytics",
            eventType: "analytics_sync_failed",
            entityType: "social_account",
            entityId: account.id,
            message: error instanceof Error ? error.message.slice(0, 1000) : "Analytics sync failed.",
          }).catch(() => undefined);
        }
      }
    }
  },

  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      if (message.body.kind === "graphic") {
        try {
          await runGraphicJob(env, message.body.graphicJobId);
          message.ack();
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message.slice(0, 1500) : "Graphic generation failed";
          const terminal = message.attempts >= 3;

          await markGraphicJobFailure(
            env,
            message.body.graphicJobId,
            errorMessage,
            terminal
          );

          if (terminal) {
            await recordSystemEvent(env, {
              severity: "error",
              category: "generation",
              eventType: "graphic_job_failed",
              entityType: "graphic_job",
              entityId: message.body.graphicJobId,
              message: errorMessage,
            }).catch(() => undefined);
            message.ack();
          } else {
            message.retry({
              delaySeconds: Math.min(
                900,
                60 * 2 ** Math.max(0, message.attempts - 1)
              ),
            });
          }
        }
        continue;
      }

      if (message.body.kind === "generate") {
        try {
          await runGenerationJob(env, message.body.jobId);
          message.ack();
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message.slice(0, 1500) : "Generation failed";
          const terminal = message.attempts >= 3;
          const now = new Date().toISOString();

          await env.DB.prepare(
            `UPDATE generation_jobs SET
             status = ?,
             error_message = ?,
             stage_updated_at = ?,
             completed_at = CASE WHEN ? THEN ? ELSE completed_at END
             WHERE id = ?`
          ).bind(
            terminal ? "failed" : "retrying",
            errorMessage,
            now,
            terminal ? 1 : 0,
            terminal ? now : null,
            message.body.jobId
          ).run();

          if (terminal) {
            await recordSystemEvent(env, {
              severity: "error",
              category: "generation",
              eventType: "generation_job_failed",
              entityType: "generation_job",
              entityId: message.body.jobId,
              message: errorMessage,
            }).catch(() => undefined);
            message.ack();
          } else {
            message.retry({
              delaySeconds: Math.min(900, 60 * 2 ** Math.max(0, message.attempts - 1)),
            });
          }
        }
        continue;
      }

      const claim = await claimPublishJob(env, message.body.publishJobId);
      if (!claim.claimed) {
        message.ack();
        continue;
      }

      const post = await env.DB.prepare(
        "SELECT id, social_account_id FROM posts WHERE id = ?"
      ).bind(message.body.postId).first<any>();

      if (!post?.social_account_id) {
        const errorMessage = "Connect and assign a social account before publishing.";
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE posts SET status = 'failed', failure_code = 'SOCIAL_ACCOUNT_REQUIRED',
               failure_message = ?, updated_at = ? WHERE id = ?`
          ).bind(errorMessage, new Date().toISOString(), message.body.postId),
          env.DB.prepare(
            `INSERT INTO publish_attempts
             (id, post_id, publish_job_id, idempotency_key, attempt, status, error_message)
             VALUES (?, ?, ?, ?, ?, 'failed', ?)`
          ).bind(
            crypto.randomUUID(),
            message.body.postId,
            message.body.publishJobId,
            `${message.body.executionKey}:attempt:${claim.attempt}`,
            claim.attempt,
            errorMessage
          ),
        ]);
        await markPublishJobFailed(env, message.body.publishJobId, errorMessage);
        await recordSystemEvent(env, {
          severity: "error",
          category: "publishing",
          eventType: "publish_job_failed",
          entityType: "publish_job",
          entityId: message.body.publishJobId,
          message: errorMessage,
          metadata: { postId: message.body.postId },
        }).catch(() => undefined);
        await notifyPostOwners(
          env,
          message.body.postId,
          "publish_failed",
          "BrandSparQ could not publish this post",
          errorMessage
        );
        message.ack();
        continue;
      }

      const attemptId = crypto.randomUUID();
      const attemptKey = `${message.body.executionKey}:attempt:${claim.attempt}`;
      const now = new Date().toISOString();

      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO publish_attempts
           (id, post_id, publish_job_id, idempotency_key, attempt, status)
           VALUES (?, ?, ?, ?, ?, 'publishing')`
        ).bind(
          attemptId,
          message.body.postId,
          message.body.publishJobId,
          attemptKey,
          claim.attempt
        ),
        env.DB.prepare(
          `UPDATE posts SET status = 'publishing', publish_started_at = COALESCE(publish_started_at, ?),
             publish_retry_count = ?, last_publish_attempt_at = ?, failure_code = NULL,
             failure_message = NULL, updated_at = ? WHERE id = ?`
        ).bind(
          now,
          Math.max(0, claim.attempt - 1),
          now,
          now,
          message.body.postId
        ),
      ]);

      try {
        const publishResult = await publishPostToSocial(env, message.body.postId);
        await env.DB.prepare(
          "UPDATE publish_attempts SET status = ? WHERE id = ?"
        ).bind(
          publishResult.confirmed ? "published" : "provider_processing",
          attemptId
        ).run();
        await markPublishJobCompleted(env, message.body.publishJobId);

        if (publishResult.confirmed) {
          await notifyPostOwners(
            env,
            message.body.postId,
            "published",
            "Post published",
            "BrandSparQ confirmed your post is live."
          );
        }

        message.ack();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message.slice(0, 1500) : "Publishing failed";
        const providerError = error as any;
        const retryable =
          typeof providerError?.retryable === "boolean"
            ? providerError.retryable
            : true;
        const exhausted = !retryable || claim.attempt >= claim.maxAttempts;

        await env.DB.batch([
          env.DB.prepare(
            "UPDATE publish_attempts SET status = 'failed', error_message = ? WHERE id = ?"
          ).bind(errorMessage, attemptId),
          env.DB.prepare(
            `UPDATE posts SET status = ?, publish_retry_count = ?, failure_code = ?,
               failure_message = ?, updated_at = ? WHERE id = ?`
          ).bind(
            exhausted ? "failed" : "publish_queued",
            claim.attempt,
            providerError?.category === "authorization"
              ? "SOCIAL_AUTH_REQUIRED"
              : providerError?.category === "rate_limit"
                ? "SOCIAL_RATE_LIMIT"
                : "PROVIDER_ERROR",
            errorMessage,
            new Date().toISOString(),
            message.body.postId
          ),
        ]);

        if (exhausted) {
          await markPublishJobFailed(env, message.body.publishJobId, errorMessage);
          await recordSystemEvent(env, {
            severity: "error",
            category: "publishing",
            eventType: "publish_job_failed",
            entityType: "publish_job",
            entityId: message.body.publishJobId,
            message: errorMessage,
            metadata: {
              postId: message.body.postId,
              category: providerError?.category || "provider",
              attempt: claim.attempt,
            },
          }).catch(() => undefined);
          await notifyPostOwners(
            env,
            message.body.postId,
            "publish_failed",
            "Post failed to publish",
            errorMessage
          );
          message.ack();
        } else {
          await markPublishJobRetry(env, message.body.publishJobId, errorMessage);
          const retryAfter =
            typeof providerError?.retryAfterSeconds === "number"
              ? providerError.retryAfterSeconds
              : Math.min(3600, 60 * 2 ** claim.attempt);
          message.retry({
            delaySeconds: Math.max(60, Math.min(3600, retryAfter)),
          });
        }
      }
    }
  },
} satisfies ExportedHandler<Env, JobMessage>;

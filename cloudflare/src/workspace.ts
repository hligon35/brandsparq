import { sendReviewLinks } from "./generation";
import type { SessionUser } from "./auth";
import { hasClientPermission, type Permission } from "./authz";
import { reserveSchedule } from "./scheduling";
import { dispatchGeneration } from "./generation-dispatch";
import type { ManagementEnv } from "./management";
type Env = ManagementEnv & { GENERATION_QUEUE: Queue<any> };
async function allowed(
  env: Env,
  user: SessionUser,
  permission: Permission,
  clientId: string,
  active = true,
) {
  if (!(await hasClientPermission(env.DB, user, permission, clientId))) return false;
  return (
    !active ||
    !!(await env.DB.prepare("SELECT id FROM clients WHERE id=? AND status='active'")
      .bind(clientId)
      .first())
  );
}
export async function handleWorkspaceRoute(
  request: Request,
  url: URL,
  env: Env,
  user: SessionUser,
) {
  const generation = url.pathname.match(
    /^\/v1\/generation-jobs(?:\/([^/]+)(?:\/(retry|cancel))?)?$/,
  );
  if (generation && request.method === "GET") {
    const rows =
      await env.DB.prepare(`SELECT g.id,g.client_id,c.name AS client_name,c.status AS client_status,g.status,g.stage,g.error_message,g.campaign_id,g.post_ids,g.creation_options,g.created_at,g.completed_at,
    (SELECT COUNT(*) FROM graphic_jobs WHERE generation_job_id=g.id) AS graphics_total,
    (SELECT COUNT(*) FROM graphic_jobs WHERE generation_job_id=g.id AND status='completed') AS graphics_completed,
    (SELECT COUNT(*) FROM graphic_jobs WHERE generation_job_id=g.id AND status='failed') AS graphics_failed
    FROM generation_jobs g JOIN clients c ON c.id=g.client_id
    WHERE (? IS NULL OR g.id=?) AND (?='owner' OR EXISTS(SELECT 1 FROM user_client_access a WHERE a.user_id=? AND a.client_id=g.client_id))
    ORDER BY g.created_at DESC,g.id LIMIT 50`)
        .bind(generation[1] || null, generation[1] || null, user.role, user.id)
        .all<any>();
    if (generation[1])
      return rows.results[0]
        ? { body: { data: rows.results[0] } }
        : { body: { error: "Generation job not found." }, status: 404 };
    return { body: { data: rows.results } };
  }
  if (generation?.[2] && request.method === "POST") {
    const job = await env.DB.prepare("SELECT * FROM generation_jobs WHERE id=?")
      .bind(generation[1])
      .first<any>();
    if (!job) return { body: { error: "Generation job not found." }, status: 404 };
    if (!(await allowed(env, user, "generate", job.client_id)))
      return {
        body: { error: "Generation permission on an active client is required." },
        status: 403,
      };
    const retry = generation[2] === "retry";
    if (
      !(retry ? ["failed", "canceled"] : ["queued", "retrying", "rendering"]).includes(job.status)
    )
      return {
        body: {
          error: "Wait for active work to finish; only failed/canceled work can be retried.",
        },
        status: 409,
      };
    const controlToken = crypto.randomUUID();
    const changed = await env.DB.batch([
      env.DB.prepare(`UPDATE generation_jobs SET status=?,stage=?,control_token=?,claim_token=NULL,error_message=NULL,stage_updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status=? AND control_token IS ? AND claim_token IS NULL AND NOT EXISTS(SELECT 1 FROM graphic_jobs WHERE generation_job_id=? AND status='processing')`).bind(
        retry ? "queued" : "canceled",
        retry ? "queued" : "canceled",
        controlToken,
        job.id,
        job.status,
        job.control_token,
        job.id,
      ),
      env.DB.prepare(`UPDATE graphic_jobs SET status=?,attempt_count=CASE WHEN ? THEN 0 ELSE attempt_count END,claimed_at=NULL,claim_token=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE generation_job_id=? AND status IN ('queued','retrying','failed','canceled') AND EXISTS(SELECT 1 FROM generation_jobs WHERE id=? AND status=? AND control_token=?)`).bind(
        retry ? "queued" : "canceled",
        retry ? 1 : 0,
        job.id,
        job.id,
        retry ? "queued" : "canceled",
        controlToken,
      ),
      env.DB.prepare(`UPDATE posts SET status=?,updated_at=CURRENT_TIMESTAMP WHERE generation_job_id=? AND approved_at IS NULL AND status IN ('review_ready','canceled','paused')
    AND EXISTS(SELECT 1 FROM generation_jobs WHERE id=? AND status=? AND control_token=?)`).bind(
        retry ? "review_ready" : "canceled",
        job.id,
        job.id,
        retry ? "queued" : "canceled",
        controlToken,
      ),
    ]);
    if (!changed[0].meta.changes)
      return {
        body: { error: "Work changed or is currently running. Refresh and try again." },
        status: 409,
      };
    if (retry) {
      if (!(await dispatchGeneration(env, job.id)))
        return {
          body: { error: "Unable to enqueue generation. Retry again.", jobId: job.id },
          status: 502,
        };
    }
    return { body: { ok: true } };
  }
  const restore = url.pathname.match(/^\/v1\/clients\/([^/]+)\/restore$/);
  if (restore && request.method === "POST") {
    if (!(await allowed(env, user, "client_manage", restore[1], false)))
      return { body: { error: "Client management permission is required." }, status: 403 };
    const result = await env.DB.prepare(
      "UPDATE clients SET status='active',archived_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='archived'",
    )
      .bind(restore[1])
      .run();
    return result.meta.changes
      ? { body: { ok: true } }
      : { body: { error: "Archived client not found." }, status: 404 };
  }
  if (url.pathname === "/v1/posts/paused" && request.method === "GET") {
    const rows =
      await env.DB.prepare(`SELECT p.id,p.client_id,c.name AS client_name,c.status AS client_status,p.title,p.platform,p.approved_at,p.scheduled_publish_at,p.paused_from_status
    FROM posts p JOIN clients c ON c.id=p.client_id WHERE p.status='paused' AND (?='owner' OR EXISTS(SELECT 1 FROM user_client_access a WHERE a.user_id=? AND a.client_id=p.client_id))
    ORDER BY p.updated_at DESC LIMIT 100`)
        .bind(user.role, user.id)
        .all();
    return { body: { data: rows.results } };
  }
  const paused = url.pathname.match(/^\/v1\/posts\/([^/]+)\/(resume|restore-review|cancel)$/);
  if (paused && request.method === "POST") {
    const post = await env.DB.prepare("SELECT * FROM posts WHERE id=?")
      .bind(paused[1])
      .first<any>();
    if (!post) return { body: { error: "Post not found." }, status: 404 };
    const action = paused[2];
    const permission = action === "restore-review" ? "review" : "calendar_manage";
    if (!(await allowed(env, user, permission, post.client_id)))
      return { body: { error: "Permission on an active client is required." }, status: 403 };
    if (
      post.status !== "paused" ||
      (action === "resume" && !post.approved_at) ||
      (action === "restore-review" && (post.approved_at || !post.graphic_key))
    )
      return {
        body: {
          error: "This paused post must be restored to its review or generation workflow first.",
        },
        status: 409,
      };
    if (action === "resume") {
      const time = await reserveSchedule(env, post.id, {
        clientId: post.client_id,
        status: post.status,
        publishVersion: post.publish_version,
        desiredAt: new Date(Date.now() + 3600000).toISOString(),
        resume: true,
      });
      return time
        ? { body: { ok: true, scheduledPublishAt: time } }
        : {
            body: { error: "Post changed or publishing has started. Refresh and try again." },
            status: 409,
          };
    }
    const [changed] = await env.DB.batch([
      env.DB.prepare(`UPDATE posts SET status=?,scheduled_publish_at=NULL,prepublish_alert_at=NULL,prepublish_response=NULL,publish_version=publish_version+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='paused' AND publish_version=?
          AND platform_post_id IS NULL
          AND NOT EXISTS(SELECT 1 FROM publish_jobs j WHERE j.post_id=posts.id AND j.status='publishing')`).bind(
        action === "restore-review" ? "awaiting_approval" : "canceled",
        post.id,
        post.publish_version,
      ),
      env.DB.prepare(`UPDATE publish_jobs SET status='canceled',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE post_id=? AND status IN ('queued','retrying') AND EXISTS(SELECT 1 FROM posts p
          WHERE p.id=publish_jobs.post_id AND p.status=? AND p.publish_version=?)`).bind(
        post.id,
        action === "restore-review" ? "awaiting_approval" : "canceled",
        post.publish_version + 1,
      ),
    ]);
    if (!changed.meta.changes)
      return { body: { error: "Post changed. Refresh and try again." }, status: 409 };
    return { body: { ok: true, scheduledPublishAt: null } };
  }
  const asset = url.pathname.match(/^\/v1\/clients\/([^/]+)\/brand-assets\/([^/]+)\/remove$/);
  if (asset && request.method === "POST") {
    if (!(await allowed(env, user, "brand_manage", asset[1])))
      return { body: { error: "Brand management permission is required." }, status: 403 };
    const row = await env.DB.prepare(
      "SELECT asset_id,role FROM brand_assets WHERE id=? AND client_id=?",
    )
      .bind(asset[2], asset[1])
      .first<any>();
    if (!row) return { body: { error: "Brand asset not found." }, status: 404 };
    await env.DB.batch([
      env.DB.prepare("DELETE FROM brand_assets WHERE id=? AND client_id=?").bind(
        asset[2],
        asset[1],
      ),
      env.DB.prepare(
        "UPDATE brand_profiles SET logo_asset_id=CASE WHEN logo_asset_id=? AND ?='logo' THEN NULL ELSE logo_asset_id END,alternate_logo_asset_id=CASE WHEN alternate_logo_asset_id=? AND ?='alternate_logo' THEN NULL ELSE alternate_logo_asset_id END WHERE client_id=?",
      ).bind(row.asset_id, row.role, row.asset_id, row.role, asset[1]),
    ]);
    return { body: { ok: true } };
  }
  const reviewLinks = url.pathname.match(/^\/v1\/clients\/([^/]+)\/review-links$/);
  if (reviewLinks) {
    if (!(await allowed(env, user, "review", reviewLinks[1])))
      return { body: { error: "Review permission is required." }, status: 403 };
    if (request.method === "GET") {
      const tokens = await env.DB.prepare(
        `SELECT rt.id,rt.recipient_email,rt.expires_at,rt.revoked_at,rt.used_at,p.title FROM review_tokens rt JOIN posts p ON p.id=rt.post_id WHERE p.client_id=? ORDER BY rt.created_at DESC LIMIT 100`,
      )
        .bind(reviewLinks[1])
        .all();
      const deliveries = await env.DB.prepare(
        "SELECT * FROM review_email_deliveries WHERE client_id=? ORDER BY created_at DESC LIMIT 20",
      )
        .bind(reviewLinks[1])
        .all();
      return { body: { data: { tokens: tokens.results, deliveries: deliveries.results } } };
    }
    if (request.method === "POST") {
      const payload = await request.json<any>().catch(() => ({}));
      if (payload.action === "revoke") {
        await env.DB.prepare(
          "UPDATE review_tokens SET revoked_at=? WHERE id=? AND post_id IN (SELECT id FROM posts WHERE client_id=?)",
        )
          .bind(Date.now(), String(payload.tokenId || ""), reviewLinks[1])
          .run();
        return { body: { ok: true } };
      }
      const result = await sendReviewLinks(env as any, reviewLinks[1]);
      return { body: { ok: true, data: result } };
    }
  }
  const reviewers = url.pathname.match(/^\/v1\/clients\/([^/]+)\/reviewers$/);
  if (reviewers) {
    if (
      !(await allowed(env, user, request.method === "GET" ? "read" : "client_manage", reviewers[1]))
    )
      return { body: { error: "Client permission is required." }, status: 403 };
    if (request.method === "GET")
      return {
        body: {
          data: (
            await env.DB.prepare(
              "SELECT id,email,enabled FROM client_reviewers WHERE client_id=? ORDER BY email",
            )
              .bind(reviewers[1])
              .all()
          ).results,
        },
      };
    if (request.method === "POST") {
      const payload = await request.json<any>().catch(() => ({}));
      const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        return { body: { error: "A valid reviewer email is required." }, status: 400 };
      await env.DB.prepare(
        "INSERT INTO client_reviewers(id,client_id,email,enabled) VALUES (?,?,?,?) ON CONFLICT(client_id,email) DO UPDATE SET enabled=excluded.enabled",
      )
        .bind(crypto.randomUUID(), reviewers[1], email, payload.enabled === false ? 0 : 1)
        .run();
      if (payload.enabled === false)
        await env.DB.prepare(
          "UPDATE review_tokens SET revoked_at=? WHERE recipient_email=? AND post_id IN (SELECT id FROM posts WHERE client_id=?)",
        )
          .bind(Date.now(), email, reviewers[1])
          .run();
      return { body: { ok: true } };
    }
  }
  return null;
}

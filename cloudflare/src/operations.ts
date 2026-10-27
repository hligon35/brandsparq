import { dispatchGeneration } from "./generation-dispatch";
import { configurePilot, pilotOverview } from "./pilot";
import { REQUIRED_SCHEMA, REQUIRED_INDEXES } from "./schema";
import { markGraphicJobFailure, recoverRevisionJobs } from "./generation";
import type { SessionUser } from "./auth";
import { hasPermission } from "./authz";
import { ensurePublishJob } from "./publishing";

export interface OperationsEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  PUBLISH_QUEUE: Queue<any>;
  GENERATION_QUEUE: Queue<any>;
  ENVIRONMENT?: string;
  RELEASE_COMMIT?: string;
  AUTH_PEPPER?: string;
  AUTH_ALLOWED_EMAILS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  REVIEW_NOTIFICATION_EMAIL?: string;
  OPENAI_API_KEY?: string;
  SOCIAL_TOKEN_KEY?: string;
  PUBLIC_BASE_URL?: string;
  GOOGLE_REDIRECT_URI?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
}

export async function recordSystemEvent(
  env: OperationsEnv,
  input: {
    severity: "info" | "warning" | "error" | "critical";
    category: string;
    eventType: string;
    entityType?: string;
    entityId?: string;
    message: string;
    metadata?: unknown;
  },
) {
  const recent =
    input.entityType && input.entityId
      ? await env.DB.prepare(
          `SELECT id FROM system_events
         WHERE event_type=? AND entity_type=? AND entity_id=? AND resolved_at IS NULL
         AND datetime(created_at) >= datetime('now','-30 minutes')
         LIMIT 1`,
        )
          .bind(input.eventType, input.entityType, input.entityId)
          .first()
      : await env.DB.prepare(
          `SELECT id FROM system_events
         WHERE event_type=? AND entity_type IS NULL AND entity_id IS NULL AND resolved_at IS NULL
         AND datetime(created_at) >= datetime('now','-30 minutes')
         LIMIT 1`,
        )
          .bind(input.eventType)
          .first();
  if (recent) return;

  await env.DB.prepare(
    `INSERT INTO system_events
     (id,severity,category,event_type,entity_type,entity_id,message,metadata_json)
     VALUES (?,?,?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      input.severity,
      input.category,
      input.eventType,
      input.entityType || null,
      input.entityId || null,
      input.message,
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
    )
    .run();
}

export async function readiness(env: OperationsEnv) {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    checks.push({ name: "database", ok: true, detail: "D1 reachable" });
  } catch (error) {
    checks.push({
      name: "database",
      ok: false,
      detail: error instanceof Error ? error.message : "D1 unavailable",
    });
  }

  try {
    await env.MEDIA.head("__brandsparq_healthcheck__");
    checks.push({ name: "media", ok: true, detail: "R2 binding reachable" });
  } catch (error) {
    checks.push({
      name: "media",
      ok: false,
      detail: error instanceof Error ? error.message : "R2 unavailable",
    });
  }

  const required = [
    ["AUTH_PEPPER", env.AUTH_PEPPER],
    ["AUTH_ALLOWED_EMAILS", env.AUTH_ALLOWED_EMAILS],
    ["GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID],
    ["GOOGLE_CLIENT_SECRET", env.GOOGLE_CLIENT_SECRET],
    ["RESEND_API_KEY", env.RESEND_API_KEY],
    ["RESEND_FROM_EMAIL", env.RESEND_FROM_EMAIL],
    ["REVIEW_NOTIFICATION_EMAIL", env.REVIEW_NOTIFICATION_EMAIL],
    ["OPENAI_API_KEY", env.OPENAI_API_KEY],
    ["SOCIAL_TOKEN_KEY", env.SOCIAL_TOKEN_KEY],
    ["PUBLIC_BASE_URL", env.PUBLIC_BASE_URL],
  ] as const;
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  checks.push({
    name: "configuration",
    ok: missing.length === 0,
    detail: missing.length
      ? `Missing: ${missing.join(", ")}`
      : "Required production configuration present",
  });

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    service: "brandsparq-api",
    environment: env.ENVIRONMENT || "unknown",
    checks,
    timestamp: new Date().toISOString(),
  };
}

export async function recoverStaleWork(env: OperationsEnv) {
  await recoverRevisionJobs(env);
  const stalePublish = await env.DB.prepare(
    `SELECT id,post_id,execution_key,attempt_count,max_attempts,last_error,status,claimed_at,updated_at
     FROM publish_jobs
     WHERE (
       (status='publishing' AND datetime(claimed_at) < datetime('now','-15 minutes'))
       OR (status IN ('queued','retrying') AND datetime(updated_at) < datetime('now','-15 minutes'))
     )
     LIMIT 50`,
  ).all<any>();

  for (const job of stalePublish.results) {
    const post = await env.DB.prepare("SELECT status FROM posts WHERE id=?")
      .bind(job.post_id)
      .first<{ status: string }>();
    if (post && ["published", "provider_processing"].includes(post.status)) {
      await env.DB.prepare(
        "UPDATE publish_jobs SET status='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
        .bind(job.id)
        .run();
      continue;
    }
    // A crashed worker may have submitted to the provider before losing its response.
    // Keep the execution fenced until an operator reconciles the provider account.
    if (job.status === "publishing") {
      await env.DB.batch([
        env.DB.prepare(`UPDATE publish_jobs SET status='failed',last_error='Publish outcome unknown; reconcile provider before retry.',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='publishing' AND claimed_at=?`).bind(job.id, job.claimed_at),
        env.DB.prepare(`UPDATE posts SET status='failed',failure_code='PUBLISH_OUTCOME_UNKNOWN',failure_message='Worker stopped during publishing. Check the provider before retrying.',updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status IN ('publishing','publish_queued') AND EXISTS (SELECT 1 FROM publish_jobs WHERE id=? AND status='failed' AND claimed_at=?)`).bind(
          job.post_id,
          job.id,
          job.claimed_at,
        ),
      ]);
      continue;
    }
    if (Number(job.attempt_count) >= Number(job.max_attempts)) {
      const now = new Date().toISOString();
      const [failed] = await env.DB.batch([
        env.DB.prepare(
          `UPDATE publish_jobs SET status='failed',completed_at=?,last_error=COALESCE(last_error,'Publishing worker timed out.'),updated_at=? WHERE id=? AND status=? AND updated_at=?`,
        ).bind(now, now, job.id, job.status, job.updated_at),
        env.DB.prepare(
          `UPDATE posts SET status='failed',failure_code='WORKER_TIMEOUT',failure_message='Publishing worker timed out.',updated_at=? WHERE id=? AND status IN ('publishing','publish_queued') AND EXISTS (SELECT 1 FROM publish_jobs WHERE id=? AND status='failed')`,
        ).bind(now, job.post_id, job.id),
      ]);
      if (!failed.meta.changes) continue;
      await recordSystemEvent(env, {
        severity: "error",
        category: "publishing",
        eventType: "publish_job_timed_out",
        entityType: "publish_job",
        entityId: job.id,
        message: "Publish job exhausted attempts after a stale worker claim.",
        metadata: { postId: job.post_id },
      });
    } else {
      const recovered = await env.DB.prepare(
        `UPDATE publish_jobs SET status='retrying',claimed_at=NULL,last_error=COALESCE(last_error,'Recovered stale publishing claim.'),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=? AND updated_at=?`,
      )
        .bind(job.id, job.status, job.updated_at)
        .run();
      if (!recovered.meta.changes) continue;
      await env.PUBLISH_QUEUE.send(
        {
          kind: "publish",
          publishJobId: job.id,
          postId: job.post_id,
          executionKey: job.execution_key,
        },
        { delaySeconds: 30 },
      );
      await recordSystemEvent(env, {
        severity: "warning",
        category: "publishing",
        eventType: "publish_job_recovered",
        entityType: "publish_job",
        entityId: job.id,
        message: "Recovered and requeued a stale publishing job.",
        metadata: { postId: job.post_id },
      });
    }
  }

  const staleGeneration = await env.DB.prepare(
    `SELECT id,status,stage,stage_updated_at,claim_token,control_token FROM generation_jobs
     WHERE status IN ('queued','processing','retrying')
       AND datetime(COALESCE(stage_updated_at,created_at)) < datetime('now','-30 minutes')
     LIMIT 25`,
  ).all<any>();

  for (const job of staleGeneration.results) {
    const recovered = await env.DB.prepare(
      `UPDATE generation_jobs SET status='queued',stage='queued',claim_token=NULL,control_token=?,stage_updated_at=CURRENT_TIMESTAMP,error_message='Recovered stale generation job.'
       WHERE id=? AND status=? AND stage_updated_at IS ? AND claim_token IS ? AND control_token IS ?
         AND EXISTS(SELECT 1 FROM clients c WHERE c.id=generation_jobs.client_id AND c.status='active')`,
    )
      .bind(
        crypto.randomUUID(),
        job.id,
        job.status,
        job.stage_updated_at,
        job.claim_token,
        job.control_token,
      )
      .run();
    if (!recovered.meta.changes) continue;
    await dispatchGeneration(env, job.id, 30);
    await recordSystemEvent(env, {
      severity: "warning",
      category: "generation",
      eventType: "generation_job_recovered",
      entityType: "generation_job",
      entityId: job.id,
      message: "Recovered and requeued a stale generation job.",
      metadata: { stage: job.stage },
    });
  }

  const staleGraphics = await env.DB.prepare(
    `SELECT id,generation_job_id,status,attempt_count,updated_at
     FROM graphic_jobs
     WHERE status IN ('queued','processing','retrying')
       AND datetime(updated_at) < datetime('now','-30 minutes')
     LIMIT 50`,
  ).all<any>();

  let graphicsRecovered = 0;
  for (const job of staleGraphics.results) {
    if (Number(job.attempt_count) >= 3) {
      const failed = await markGraphicJobFailure(
        env as any,
        job.id,
        "Graphic worker timed out.",
        true,
        { status: job.status, updatedAt: job.updated_at },
      );
      if (!failed) continue;
      await recordSystemEvent(env, {
        severity: "error",
        category: "generation",
        eventType: "graphic_job_timed_out",
        entityType: "graphic_job",
        entityId: job.id,
        message: "Graphic job exhausted attempts after becoming stale.",
        metadata: { generationJobId: job.generation_job_id },
      });
      continue;
    }
    const recovered = await env.DB.prepare(
      `UPDATE graphic_jobs SET status='retrying',claimed_at=NULL,claim_token=NULL,last_error=COALESCE(last_error,'Recovered stale graphic job.'),updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status=? AND updated_at=? AND EXISTS(SELECT 1 FROM generation_jobs g JOIN clients c ON c.id=g.client_id
          WHERE g.id=graphic_jobs.generation_job_id AND g.status NOT IN ('canceled','failed') AND c.status='active')`,
    )
      .bind(job.id, job.status, job.updated_at)
      .run();
    if (!recovered.meta.changes) continue;
    await env.GENERATION_QUEUE.send(
      { kind: "graphic", graphicJobId: job.id },
      { delaySeconds: 30 },
    );
    graphicsRecovered++;
    await recordSystemEvent(env, {
      severity: "warning",
      category: "generation",
      eventType: "graphic_job_recovered",
      entityType: "graphic_job",
      entityId: job.id,
      message: "Recovered and requeued a stale graphic job.",
      metadata: { generationJobId: job.generation_job_id },
    });
  }

  const nowMs = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM request_rate_limits WHERE window_started_at < ?").bind(
      nowMs - 24 * 60 * 60 * 1000,
    ),
    env.DB.prepare("DELETE FROM google_oauth_states WHERE expires_at < ?").bind(nowMs),
    env.DB.prepare("DELETE FROM google_auth_handoffs WHERE expires_at < ?").bind(nowMs),
    env.DB.prepare("DELETE FROM social_oauth_states WHERE expires_at < ?").bind(nowMs),
    env.DB.prepare("DELETE FROM media_access_tokens WHERE expires_at < ?").bind(nowMs),
    env.DB.prepare("DELETE FROM publish_media_tokens WHERE expires_at < ?").bind(nowMs),
    env.DB.prepare("DELETE FROM review_tokens WHERE expires_at < ?").bind(nowMs),
    env.DB.prepare(
      "DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)",
    ).bind(nowMs, nowMs - 7 * 24 * 60 * 60 * 1000),
  ]);

  return {
    publishRecovered: stalePublish.results.length,
    generationRecovered: staleGeneration.results.length,
    graphicsRecovered,
  };
}

export async function getSystemOverview(env: OperationsEnv) {
  const [health, publish, generation, failedPosts, events, social, reconciliations] =
    await Promise.all([
      readiness(env),
      env.DB.prepare(
        `SELECT status,COUNT(*) AS count FROM publish_jobs
       WHERE datetime(created_at)>=datetime('now','-7 days') GROUP BY status`,
      ).all<any>(),
      env.DB.prepare(
        `SELECT status,COUNT(*) AS count FROM generation_jobs
       WHERE datetime(created_at)>=datetime('now','-7 days') GROUP BY status`,
      ).all<any>(),
      env.DB.prepare(
        `SELECT p.id,p.title,p.platform,p.failure_code,p.failure_message,p.publish_version,p.social_account_id,p.updated_at,c.name AS client_name
       FROM posts p JOIN clients c ON c.id=p.client_id
       WHERE p.status='failed' ORDER BY p.updated_at DESC LIMIT 20`,
      ).all<any>(),
      env.DB.prepare(
        `SELECT * FROM system_events
       WHERE resolved_at IS NULL ORDER BY
       CASE severity WHEN 'critical' THEN 1 WHEN 'error' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
       created_at DESC LIMIT 50`,
      ).all<any>(),
      env.DB.prepare(
        `SELECT status,COUNT(*) AS count FROM social_accounts GROUP BY status`,
      ).all<any>(),
      env.DB.prepare(`SELECT a.id,a.entity_id,a.next_state,a.metadata_json,a.created_at,u.email AS actor_email,p.title
      FROM recovery_actions a JOIN users u ON u.id=a.actor_user_id LEFT JOIN posts p ON p.id=a.entity_id
      WHERE a.action='reconcile_publish_outcome' ORDER BY a.created_at DESC,a.id LIMIT 20`).all<any>(),
    ]);
  return {
    health,
    publishJobs: publish.results,
    generationJobs: generation.results,
    failedPosts: failedPosts.results,
    reconciliations: reconciliations.results.map((row) => ({
      ...row,
      metadata: JSON.parse(row.metadata_json || "{}"),
    })),
    events: events.results,
    socialAccounts: social.results,
  };
}

export async function runLaunchCertification(env: OperationsEnv, user: SessionUser) {
  const checks: Array<{ name: string; ok: boolean; level: "blocker" | "warning"; detail: string }> =
    [];
  const check = (name: string, ok: boolean, level: "blocker" | "warning", detail: string) =>
    checks.push({ name, ok, level, detail });

  const health = await readiness(env);
  for (const item of health.checks) {
    check(`readiness:${item.name}`, item.ok, "blocker", item.detail);
  }

  check(
    "production:base-url",
    env.ENVIRONMENT === "staging"
      ? !!env.PUBLIC_BASE_URL &&
          /^https:\/\/brandsparq-staging\.[a-z0-9-]+\.workers\.dev$/.test(env.PUBLIC_BASE_URL)
      : env.PUBLIC_BASE_URL === "https://brandsparq.getsparqd.com",
    "blocker",
    (
      env.ENVIRONMENT === "staging"
        ? !!env.PUBLIC_BASE_URL &&
          /^https:\/\/brandsparq-staging\.[a-z0-9-]+\.workers\.dev$/.test(env.PUBLIC_BASE_URL)
        : env.PUBLIC_BASE_URL === "https://brandsparq.getsparqd.com"
    )
      ? "Production base URL is correct."
      : "PUBLIC_BASE_URL must be https://brandsparq.getsparqd.com.",
  );
  check(
    "production:google-redirect",
    env.GOOGLE_REDIRECT_URI === `${env.PUBLIC_BASE_URL}/v1/auth/google/callback`,
    "blocker",
    env.GOOGLE_REDIRECT_URI === `${env.PUBLIC_BASE_URL}/v1/auth/google/callback`
      ? "Google callback is production-safe."
      : "Google redirect URI does not match the production callback.",
  );

  const tableRows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{
    name: string;
  }>();
  const tables = new Set(tableRows.results.map((row) => row.name));
  for (const [table, columns] of Object.entries(REQUIRED_SCHEMA)) {
    check(
      `schema:${table}`,
      tables.has(table),
      "blocker",
      tables.has(table) ? `${table} is present.` : `Missing required table: ${table}.`,
    );
    if (!tables.has(table)) continue;
    const actual = await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>();
    for (const column of columns) {
      const found = actual.results.find((row) => row.name === column.name);
      check(
        `schema:${table}.${column.name}`,
        !!found &&
          found.type === column.type &&
          found.notnull === column.notnull &&
          found.pk === column.pk,
        "blocker",
        `Required column definition: ${table}.${column.name}.`,
      );
    }
  }
  const indexes = await env.DB.prepare(
    "SELECT name,sql FROM sqlite_master WHERE type='index'",
  ).all<{
    name: string;
    sql: string;
  }>();
  const indexNames = new Map(indexes.results.map((row) => [row.name, row.sql]));
  for (const index of REQUIRED_INDEXES)
    check(
      `schema:index:${index.name}`,
      indexNames.get(index.name) === index.sql,
      "blocker",
      `Required index definition: ${index.name}.`,
    );
  const foreignKeys = await env.DB.prepare("PRAGMA foreign_key_check").all();
  check(
    "schema:foreign-keys",
    foreignKeys.results.length === 0,
    "blocker",
    `${foreignKeys.results.length} foreign-key violation(s).`,
  );
  // Missing schema must produce a useful blocked result before dependent queries run.
  if (checks.some((item) => !item.ok && item.name.startsWith("schema:"))) {
    return {
      id: null,
      status: "blocked",
      blockers: checks
        .filter((item) => !item.ok && item.level === "blocker")
        .map((item) => item.detail),
      warnings: [],
      checks,
      createdAt: new Date().toISOString(),
    };
  }

  const owners = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM users WHERE role='owner' AND status='active'",
  ).first<{ count: number }>();
  check(
    "access:owner",
    Number(owners?.count || 0) > 0,
    "blocker",
    `${Number(owners?.count || 0)} owner account(s) configured.`,
  );

  const orphanAccess = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM user_client_access a
     LEFT JOIN users u ON u.id=a.user_id
     LEFT JOIN clients c ON c.id=a.client_id
     WHERE u.id IS NULL OR c.id IS NULL`,
  ).first<{ count: number }>();
  check(
    "access:integrity",
    Number(orphanAccess?.count || 0) === 0,
    "blocker",
    `${Number(orphanAccess?.count || 0)} orphan client-access row(s).`,
  );

  const critical = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM system_events WHERE resolved_at IS NULL AND severity IN ('critical','error')",
  ).first<{ count: number }>();
  check(
    "operations:incidents",
    Number(critical?.count || 0) === 0,
    "warning",
    `${Number(critical?.count || 0)} unresolved critical/error incident(s).`,
  );

  const failedPosts = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM posts WHERE status='failed'",
  ).first<{ count: number }>();
  check(
    "operations:failed-posts",
    Number(failedPosts?.count || 0) === 0,
    "warning",
    `${Number(failedPosts?.count || 0)} failed post(s) currently require attention.`,
  );

  const connected = await env.DB.prepare(
    "SELECT platform,COUNT(*) AS count FROM social_accounts WHERE status='connected' GROUP BY platform",
  ).all<{ platform: string; count: number }>();
  if (!connected.results.length) {
    check(
      "social:connections",
      false,
      "warning",
      "No production social accounts are connected yet.",
    );
  }
  const providerConfig: Record<string, boolean> = {
    instagram: !!env.META_APP_ID && !!env.META_APP_SECRET,
    facebook: !!env.META_APP_ID && !!env.META_APP_SECRET,
    linkedin: !!env.LINKEDIN_CLIENT_ID && !!env.LINKEDIN_CLIENT_SECRET,
    tiktok: !!env.TIKTOK_CLIENT_KEY && !!env.TIKTOK_CLIENT_SECRET,
    x: !!env.X_CLIENT_ID && !!env.X_CLIENT_SECRET,
  };
  for (const row of connected.results) {
    const ok = providerConfig[row.platform] === true;
    check(
      `social:${row.platform}`,
      ok,
      "blocker",
      ok
        ? `${row.platform} credentials present for ${row.count} connected account(s).`
        : `${row.platform} has connected accounts but missing provider credentials.`,
    );
  }
  const hasMeta = connected.results.some(
    (row) => row.platform === "facebook" || row.platform === "instagram",
  );
  if (hasMeta) {
    check(
      "social:meta-webhook",
      !!env.META_WEBHOOK_VERIFY_TOKEN,
      "warning",
      env.META_WEBHOOK_VERIFY_TOKEN
        ? "Meta webhook verification token is configured."
        : "Meta accounts are connected but META_WEBHOOK_VERIFY_TOKEN is not configured.",
    );
  }

  const blockers = checks
    .filter((item) => !item.ok && item.level === "blocker")
    .map((item) => item.detail);
  const warnings = checks
    .filter((item) => !item.ok && item.level === "warning")
    .map((item) => item.detail);
  const status = blockers.length ? "blocked" : warnings.length ? "ready_with_warnings" : "ready";
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO launch_certification_runs
     (id,actor_user_id,status,blockers_json,warnings_json,checks_json)
     VALUES (?,?,?,?,?,?)`,
  )
    .bind(
      id,
      user.id,
      status,
      JSON.stringify(blockers),
      JSON.stringify(warnings),
      JSON.stringify(checks),
    )
    .run();

  return { id, status, blockers, warnings, checks, createdAt: new Date().toISOString() };
}

export async function handleOperationsRoute(
  request: Request,
  url: URL,
  env: OperationsEnv,
  user: SessionUser,
): Promise<{ body: unknown; status?: number } | null> {
  if (!url.pathname.startsWith("/v1/system")) return null;
  if (!hasPermission(user, "system_manage"))
    return { body: { error: "Owner access is required for system operations." }, status: 403 };

  if (url.pathname === "/v1/system/pilot") {
    if (request.method === "GET") return { body: { data: await pilotOverview(env) } };
    if (request.method === "POST")
      return configurePilot(env, user, await request.json().catch(() => null));
  }

  if (request.method === "GET" && url.pathname === "/v1/system/overview") {
    return { body: { data: await getSystemOverview(env) } };
  }

  if (request.method === "POST" && url.pathname === "/v1/system/certify") {
    return { body: { data: await runLaunchCertification(env, user) } };
  }

  if (request.method === "GET" && url.pathname === "/v1/system/certifications") {
    const rows = await env.DB.prepare(
      "SELECT id,status,blockers_json,warnings_json,created_at FROM launch_certification_runs ORDER BY created_at DESC LIMIT 10",
    ).all<any>();
    return {
      body: {
        data: rows.results.map((row) => ({
          ...row,
          blockers: JSON.parse(row.blockers_json || "[]"),
          warnings: JSON.parse(row.warnings_json || "[]"),
        })),
      },
    };
  }

  if (request.method === "GET" && url.pathname === "/v1/system/access") {
    const [users, clients, access] = await Promise.all([
      env.DB.prepare(
        "SELECT id,email,name,role,status,created_at,updated_at FROM users ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,email",
      ).all<any>(),
      env.DB.prepare(
        "SELECT id,name,status FROM clients WHERE COALESCE(status,'active')!='archived' ORDER BY name",
      ).all<any>(),
      env.DB.prepare(
        "SELECT a.user_id,a.client_id,COALESCE(a.permission_role,u.role) AS access_role,a.created_at FROM user_client_access a JOIN users u ON u.id=a.user_id ORDER BY a.created_at",
      ).all<any>(),
    ]);
    return {
      body: { data: { users: users.results, clients: clients.results, access: access.results } },
    };
  }

  const roleMatch = url.pathname.match(/^\/v1\/system\/users\/([^/]+)\/role$/);
  if (request.method === "POST" && roleMatch) {
    const payload = await request.json<{ role?: string }>().catch(() => ({}) as any);
    const role = String(payload.role || "").toLowerCase();
    if (!["owner", "admin", "reviewer", "publisher", "viewer"].includes(role)) {
      return { body: { error: "Invalid workspace role." }, status: 400 };
    }
    const target = await env.DB.prepare("SELECT id,role,status FROM users WHERE id=?")
      .bind(roleMatch[1])
      .first<any>();
    if (!target) return { body: { error: "User not found." }, status: 404 };
    if (target.status === "invited")
      return {
        body: { error: "Revoke and resend the invitation to change its role." },
        status: 409,
      };
    if (target.role === "owner" && role !== "owner") {
      const owners = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role='owner'",
      ).first<{ count: number }>();
      if (Number(owners?.count || 0) <= 1)
        return { body: { error: "BrandSparQ must keep at least one owner." }, status: 409 };
    }
    const changed =
      await env.DB.prepare(`UPDATE users SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND
      (role!='owner' OR ?='owner' OR status!='active' OR (SELECT COUNT(*) FROM users WHERE role='owner' AND status='active')>1)`)
        .bind(role, target.id, role)
        .run();
    if (!changed.meta.changes)
      return { body: { error: "BrandSparQ must keep an active owner." }, status: 409 };
    await env.DB.prepare(
      `INSERT INTO recovery_actions (id,actor_user_id,action,entity_type,entity_id,previous_state,next_state)
       VALUES (?,?,'change_user_role','user',?,?,?)`,
    )
      .bind(crypto.randomUUID(), user.id, target.id, target.role, role)
      .run();
    return { body: { ok: true } };
  }

  const accessMatch = url.pathname.match(/^\/v1\/system\/users\/([^/]+)\/clients\/([^/]+)$/);
  if (accessMatch && request.method === "POST") {
    const payload = await request
      .json<{ enabled?: boolean; accessRole?: string }>()
      .catch(() => ({}) as any);
    const target = await env.DB.prepare("SELECT id,role FROM users WHERE id=?")
      .bind(accessMatch[1])
      .first<any>();
    const client = await env.DB.prepare("SELECT id FROM clients WHERE id=?")
      .bind(accessMatch[2])
      .first<any>();
    if (!target || !client) return { body: { error: "User or client not found." }, status: 404 };
    if (target.role === "owner")
      return { body: { error: "Owners already have workspace-wide client access." }, status: 409 };

    if (payload.enabled === false) {
      await env.DB.prepare("DELETE FROM user_client_access WHERE user_id=? AND client_id=?")
        .bind(target.id, client.id)
        .run();
    } else {
      const accessRole = String(payload.accessRole || target.role || "viewer");
      if (!["admin", "reviewer", "publisher", "viewer"].includes(accessRole))
        return { body: { error: "Invalid client role." }, status: 400 };
      await env.DB.prepare(
        `INSERT INTO user_client_access (user_id,client_id,access_role,permission_role)
         VALUES (?,?,?,?)
         ON CONFLICT(user_id,client_id) DO UPDATE SET access_role=excluded.access_role,permission_role=excluded.permission_role`,
      )
        .bind(target.id, client.id, accessRole, accessRole)
        .run();
    }
    await env.DB.prepare(
      `INSERT INTO recovery_actions (id,actor_user_id,action,entity_type,entity_id,metadata_json)
       VALUES (?,?,'change_client_access','user',?,?)`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        target.id,
        JSON.stringify({ clientId: client.id, enabled: payload.enabled !== false }),
      )
      .run();
    return { body: { ok: true } };
  }

  if (request.method === "POST" && url.pathname === "/v1/system/recover") {
    const result = await recoverStaleWork(env);
    await env.DB.prepare(
      `INSERT INTO recovery_actions (id,actor_user_id,action,entity_type,entity_id,metadata_json)
       VALUES (?,?,'recover_stale','system','brandsparq',?)`,
    )
      .bind(crypto.randomUUID(), user.id, JSON.stringify(result))
      .run();
    return { body: { ok: true, data: result } };
  }

  const reconcile = url.pathname.match(/^\/v1\/system\/posts\/([^/]+)\/reconcile$/);
  if (request.method === "POST" && reconcile) {
    const payload = await request.json<any>().catch(() => null);
    if (
      !payload ||
      !["published", "absent"].includes(payload.outcome) ||
      !Number.isInteger(payload.publishVersion) ||
      typeof payload.evidence !== "string" ||
      payload.evidence.trim().length < 20 ||
      payload.evidence.length > 4000 ||
      (payload.outcome === "published" &&
        (typeof payload.providerPostId !== "string" ||
          !payload.providerPostId.trim() ||
          payload.providerPostId.length > 500))
    )
      return {
        body: {
          error:
            "Choose an outcome, provide the current version and at least 20 characters of provider verification evidence; published outcomes also require a provider post ID.",
        },
        status: 400,
      };
    const id = reconcile[1],
      now = new Date().toISOString(),
      actionId = crypto.randomUUID();
    const published = payload.outcome === "published";
    const providerId = published ? payload.providerPostId.trim() : null;
    const nextCode = published ? null : "PUBLISH_CONFIRMED_ABSENT";
    // The audit insert and transition are one transaction. Competing decisions,
    // late receipts, and repeated requests cannot change an already resolved post.
    const [changed] = await env.DB.batch([
      env.DB.prepare(`UPDATE posts SET status=?,platform_post_id=?,published_at=CASE WHEN ? THEN ? ELSE published_at END,
          failure_code=?,failure_message=?,publish_version=publish_version+1,reconciliation_id=?,updated_at=?
        WHERE id=? AND status='failed' AND failure_code='PUBLISH_OUTCOME_UNKNOWN' AND publish_version=?
          AND platform_post_id IS NULL
          AND (?=1 OR NOT EXISTS(SELECT 1 FROM social_publish_receipts r WHERE r.post_id=posts.id AND r.status IN ('published','provider_processing')))
          AND NOT EXISTS(SELECT 1 FROM publish_jobs j WHERE j.post_id=posts.id AND j.status='publishing')
          AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM posts other WHERE other.id!=posts.id
            AND other.platform=posts.platform AND other.social_account_id IS posts.social_account_id AND other.platform_post_id=?))`).bind(
        published ? "published" : "failed",
        providerId,
        published ? 1 : 0,
        now,
        nextCode,
        published ? null : "Owner verified absence at provider; explicit retry is available.",
        actionId,
        now,
        id,
        payload.publishVersion,
        published ? 1 : 0,
        providerId,
        providerId,
      ),
      env.DB.prepare(`INSERT INTO recovery_actions(id,actor_user_id,action,entity_type,entity_id,previous_state,next_state,metadata_json)
        SELECT ?,?,'reconcile_publish_outcome','post',id,'PUBLISH_OUTCOME_UNKNOWN',?,? FROM posts
        WHERE id=? AND publish_version=? AND status=? AND failure_code IS ? AND reconciliation_id=?`).bind(
        actionId,
        user.id,
        published ? "published" : "confirmed_absent",
        JSON.stringify({
          outcome: payload.outcome,
          providerPostId: providerId,
          evidence: payload.evidence.trim(),
        }),
        id,
        payload.publishVersion + 1,
        published ? "published" : "failed",
        nextCode,
        actionId,
      ),
      ...(published
        ? [
            env.DB.prepare(`INSERT INTO social_publish_receipts
        (id,post_id,social_account_id,provider_post_id,status,provider_status,last_checked_at,confirmed_at,raw_json)
        SELECT ?,id,social_account_id,?,'published','owner_verified',?,?,? FROM posts
        WHERE id=? AND reconciliation_id=? AND social_account_id IS NOT NULL`).bind(
              crypto.randomUUID(),
              providerId,
              now,
              now,
              JSON.stringify({ recoveryActionId: actionId }),
              id,
              actionId,
            ),
          ]
        : []),
      env.DB.prepare(`UPDATE publish_jobs SET status=?,completed_at=?,updated_at=?
        WHERE post_id=? AND status IN ('queued','retrying','failed')
          AND EXISTS(SELECT 1 FROM recovery_actions WHERE id=?)`).bind(
        published ? "completed" : "canceled",
        now,
        now,
        id,
        actionId,
      ),
    ]);
    if (!changed.meta.changes)
      return {
        body: {
          error:
            "Post changed, is still publishing, or the provider receipt is already assigned. Refresh and reconcile the current state.",
        },
        status: 409,
      };
    return { body: { ok: true, outcome: payload.outcome } };
  }

  const retryPost = url.pathname.match(/^\/v1\/system\/posts\/([^/]+)\/retry$/);
  if (request.method === "POST" && retryPost) {
    const post = await env.DB.prepare(
      "SELECT id,status,scheduled_publish_at,publish_version,failure_code,client_id FROM posts WHERE id=?",
    )
      .bind(retryPost[1])
      .first<any>();
    if (!post) return { body: { error: "Post not found." }, status: 404 };
    if (post.failure_code === "PUBLISH_OUTCOME_UNKNOWN")
      return {
        body: {
          error:
            "Confirm this post's outcome at the provider before creating replacement content. Automatic retry is blocked to prevent duplicate publication.",
        },
        status: 409,
      };
    const client = await env.DB.prepare("SELECT status FROM clients WHERE id=?")
      .bind(post.client_id)
      .first<{ status: string }>();
    if (!client || client.status !== "active")
      return { body: { error: "Archived clients cannot publish." }, status: 409 };
    if (post.status !== "failed")
      return {
        body: { error: "Only failed posts can be retried from System Health." },
        status: 409,
      };

    const now = new Date().toISOString();
    const changed = await env.DB.prepare(
      `UPDATE posts SET status='calendar_scheduled',failure_code=NULL,failure_message=NULL,publish_version=publish_version+1,updated_at=?
        WHERE id=? AND status='failed' AND publish_version=? AND platform_post_id IS NULL
          AND COALESCE(failure_code,'')!='PUBLISH_OUTCOME_UNKNOWN'
          AND NOT EXISTS(SELECT 1 FROM social_publish_receipts r WHERE r.post_id=posts.id AND r.status IN ('published','provider_processing'))
          AND EXISTS(SELECT 1 FROM clients c WHERE c.id=posts.client_id AND c.status='active')
          AND NOT EXISTS(SELECT 1 FROM publish_jobs j WHERE j.post_id=posts.id AND j.status='publishing')`,
    )
      .bind(now, post.id, post.publish_version)
      .run();
    if (!changed.meta.changes)
      return {
        body: { error: "Post changed or publishing has started. Refresh before retrying." },
        status: 409,
      };
    const job = await ensurePublishJob(
      env,
      post.id,
      post.scheduled_publish_at || now,
      undefined,
      undefined,
      post.publish_version + 1,
    );
    if (!job.jobId)
      return {
        body: { error: "Post changed before enqueueing. Refresh and try again." },
        status: 409,
      };
    if (job.shouldEnqueue) {
      await env.PUBLISH_QUEUE.send({
        kind: "publish",
        publishJobId: job.jobId,
        postId: post.id,
        executionKey: job.executionKey,
      });
    }
    await env.DB.prepare(
      `INSERT INTO recovery_actions (id,actor_user_id,action,entity_type,entity_id,previous_state,next_state,metadata_json)
       VALUES (?,?,'retry_failed_post','post',?,'failed','calendar_scheduled',?)`,
    )
      .bind(crypto.randomUUID(), user.id, post.id, JSON.stringify({ publishJobId: job.jobId }))
      .run();
    return { body: { ok: true, publishJobId: job.jobId } };
  }

  const resolveEvent = url.pathname.match(/^\/v1\/system\/events\/([^/]+)\/resolve$/);
  if (request.method === "POST" && resolveEvent) {
    await env.DB.prepare("UPDATE system_events SET resolved_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(resolveEvent[1])
      .run();
    await env.DB.prepare(
      `INSERT INTO recovery_actions (id,actor_user_id,action,entity_type,entity_id,next_state)
       VALUES (?,?,'resolve_event','system_event',?,'resolved')`,
    )
      .bind(crypto.randomUUID(), user.id, resolveEvent[1])
      .run();
    return { body: { ok: true } };
  }

  return { body: { error: "System route not found." }, status: 404 };
}

export async function enforceRateLimit(
  env: OperationsEnv,
  bucket: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT window_started_at,request_count FROM request_rate_limits WHERE bucket=?",
  )
    .bind(bucket)
    .first<{ window_started_at: number; request_count: number }>();

  if (!row || now - row.window_started_at >= windowMs) {
    await env.DB.prepare(
      `INSERT INTO request_rate_limits (bucket,window_started_at,request_count,updated_at)
       VALUES (?,?,1,CURRENT_TIMESTAMP)
       ON CONFLICT(bucket) DO UPDATE SET window_started_at=excluded.window_started_at,request_count=1,updated_at=CURRENT_TIMESTAMP`,
    )
      .bind(bucket, now)
      .run();
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  if (row.request_count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((windowMs - (now - row.window_started_at)) / 1000)),
    };
  }

  await env.DB.prepare(
    "UPDATE request_rate_limits SET request_count=request_count+1,updated_at=CURRENT_TIMESTAMP WHERE bucket=?",
  )
    .bind(bucket)
    .run();
  return { allowed: true, remaining: Math.max(0, limit - row.request_count - 1), retryAfter: 0 };
}

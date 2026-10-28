import { syncAccountAnalytics } from "./social";
import type { ManagementEnv } from "./management";
type Env = ManagementEnv;
export async function enqueueAnalytics(env: Env, accountId: string, days = 90) {
  const existing = await env.DB.prepare(
    "SELECT id,status FROM analytics_jobs WHERE social_account_id=? AND status IN ('queued','running')",
  )
    .bind(accountId)
    .first<any>();
  if (existing) return existing;
  if (!Number.isInteger(days) || days < 1 || days > 365)
    throw new Error("Choose an analytics range between 1 and 365 days.");
  const posts = await env.DB.prepare(
    "SELECT id FROM posts WHERE social_account_id=? AND status='published' AND platform_post_id IS NOT NULL AND julianday(published_at)>=julianday('now')-? ORDER BY published_at DESC,id LIMIT 1001",
  )
    .bind(accountId, days)
    .all<{ id: string }>();
  if (posts.results.length > 1000)
    throw new Error(
      "Analytics sync supports up to 1000 posts per account in the selected period. Choose a shorter date range in Analytics and sync again.",
    );
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO analytics_jobs(id,social_account_id,range_days) VALUES (?,?,?)",
    ).bind(id, accountId, days),
    env.DB.prepare(
      "INSERT INTO analytics_job_items(job_id,post_id) SELECT ?,value FROM json_each(?) WHERE EXISTS(SELECT 1 FROM analytics_jobs WHERE id=?)",
    ).bind(id, JSON.stringify(posts.results.map((p) => p.id)), id),
  ]);
  const job = await env.DB.prepare(
    "SELECT id,status FROM analytics_jobs WHERE social_account_id=? AND status IN ('queued','running')",
  )
    .bind(accountId)
    .first<any>();
  try {
    await env.GENERATION_QUEUE?.send({ kind: "analytics", jobId: job.id });
  } catch {
    /* Cron recovers the durable job. */
  }
  return job;
}
export async function runAnalyticsJob(env: Env, id: string) {
  const claim = crypto.randomUUID(),
    now = Date.now();
  const changed = await env.DB.prepare(
    "UPDATE analytics_jobs SET status='running',claim_token=?,claim_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','running') AND (claim_until IS NULL OR claim_until<?)",
  )
    .bind(claim, now + 300000, id, now)
    .run();
  if (!changed.meta.changes) return;
  const job = await env.DB.prepare("SELECT * FROM analytics_jobs WHERE id=?").bind(id).first<any>();
  const item = await env.DB.prepare(
    "SELECT post_id FROM analytics_job_items WHERE job_id=? AND status='queued' ORDER BY post_id LIMIT 1",
  )
    .bind(id)
    .first<{ post_id: string }>();
  let error: string | null = null;
  try {
    const result = await syncAccountAnalytics(
      env,
      job.social_account_id,
      item?.post_id || "__empty__",
    );
    if (result.status === "unsupported") error = "Provider analytics unavailable for this account.";
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 1000) : "Analytics failed.";
  }
  const pending = await env.DB.prepare(
    "SELECT COUNT(*) n FROM analytics_job_items WHERE job_id=? AND status='queued'",
  )
    .bind(id)
    .first<{ n: number }>();
  const more = Number(pending?.n || 0) > (item ? 1 : 0);
  await env.DB.batch([
    ...(item
      ? [
          env.DB.prepare(
            "UPDATE analytics_job_items SET status=? WHERE job_id=? AND post_id=? AND EXISTS(SELECT 1 FROM analytics_jobs WHERE id=? AND claim_token=?)",
          ).bind(error ? "failed" : "completed", id, item.post_id, id, claim),
        ]
      : []),
    env.DB.prepare(
      "UPDATE analytics_jobs SET processed=processed+?,failed=failed+?,error_message=COALESCE(?,error_message),status=?,claim_token=NULL,claim_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claim_token=?",
    ).bind(
      item ? 1 : 0,
      error ? 1 : 0,
      error,
      more ? "queued" : error || job.failed ? "partial" : "completed",
      id,
      claim,
    ),
  ]);
  if (more)
    try {
      await env.GENERATION_QUEUE?.send({ kind: "analytics", jobId: id });
    } catch {
      /* Cron retries. */
    }
}
export async function recoverAnalyticsJobs(env: Env) {
  const jobs = await env.DB.prepare(
    "SELECT id FROM analytics_jobs WHERE status IN ('queued','running') AND (claim_until IS NULL OR claim_until<?) ORDER BY updated_at,id LIMIT 20",
  )
    .bind(Date.now())
    .all<{ id: string }>();
  for (const job of jobs.results)
    try {
      await env.GENERATION_QUEUE?.send({ kind: "analytics", jobId: job.id });
    } catch {
      /* Durable jobs remain eligible next minute. */
    }
  // Bounded retention of terminal job detail and old samples/runs. Keep latest good sample for each post.
  await env.DB.prepare(
    "DELETE FROM analytics_jobs WHERE id IN (SELECT id FROM analytics_jobs WHERE status NOT IN ('queued','running') AND updated_at<datetime('now','-30 days') LIMIT 100)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM analytics_sync_runs WHERE id IN (SELECT id FROM analytics_sync_runs WHERE completed_at<datetime('now','-90 days') LIMIT 100)",
  ).run();
  await env.DB.prepare(
    "DELETE FROM post_metrics WHERE rowid IN (SELECT m.rowid FROM post_metrics m WHERE measured_at<datetime('now','-90 days') AND EXISTS(SELECT 1 FROM post_metrics n WHERE n.post_id=m.post_id AND n.rowid>m.rowid) LIMIT 100)",
  ).run();
}

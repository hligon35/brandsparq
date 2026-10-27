import { postCampaign, campaignOpen } from "./campaign-workflow";
export interface PublishingEnv {
  DB: D1Database;
}

export type PublishQueueMessage = {
  kind: "publish";
  publishJobId: string;
  postId: string;
  executionKey: string;
};

export async function ensurePublishJob(
  env: PublishingEnv,
  postId: string,
  scheduledFor?: string | null,
  supervisorId?: string,
  pilotRevision?: number,
  expectedVersion?: number,
): Promise<{ jobId: string; executionKey: string; shouldEnqueue: boolean }> {
  const post = await env.DB.prepare("SELECT publish_version FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ publish_version: number }>();
  if (!post) throw new Error("Post not found while creating publish job.");

  const executionKey = `post:${postId}:publish:v${expectedVersion ?? post.publish_version}`;
  if (expectedVersion !== undefined && post.publish_version !== expectedVersion)
    return { jobId: "", executionKey, shouldEnqueue: false };
  const candidateId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO publish_jobs
     (id, post_id, execution_key, status, scheduled_for)
     SELECT ?,?,?,'queued',? FROM posts WHERE id=? AND publish_version=?`,
  )
    .bind(
      candidateId,
      postId,
      executionKey,
      scheduledFor || null,
      postId,
      expectedVersion ?? post.publish_version,
    )
    .run();

  if (supervisorId)
    await env.DB.prepare(`UPDATE publish_jobs SET supervised_by=?,pilot_revision=COALESCE(?,(SELECT revision FROM pilot_settings WHERE id='default'))
    WHERE execution_key=? AND status IN ('queued','retrying') AND EXISTS(SELECT 1 FROM users WHERE id=? AND role='owner' AND status='active')`)
      .bind(supervisorId, pilotRevision ?? null, executionKey, supervisorId)
      .run();

  const row = await env.DB.prepare(
    `SELECT id, status, claimed_at
     FROM publish_jobs
     WHERE execution_key = ?`,
  )
    .bind(executionKey)
    .first<{
      id: string;
      status: string;
      claimed_at: string | null;
    }>();

  if (!row) return { jobId: "", executionKey, shouldEnqueue: false };

  return {
    jobId: row.id,
    executionKey,
    shouldEnqueue: row.status === "queued" && !row.claimed_at,
  };
}

export async function claimPublishJob(
  env: PublishingEnv,
  publishJobId: string,
): Promise<{
  claimed: boolean;
  attempt: number;
  maxAttempts: number;
  postId?: string;
  executionKey?: string;
  eligible?: boolean;
}> {
  const row = await env.DB.prepare(
    `SELECT id, post_id, execution_key, status, attempt_count, max_attempts
     FROM publish_jobs WHERE id = ?`,
  )
    .bind(publishJobId)
    .first<any>();

  if (!row || !["queued", "retrying"].includes(row.status)) {
    return {
      claimed: false,
      attempt: Number(row?.attempt_count || 0),
      maxAttempts: Number(row?.max_attempts || 3),
      postId: row?.post_id,
      executionKey: row?.execution_key,
    };
  }

  const campaign = await postCampaign(env, row.post_id);
  if (!campaignOpen(campaign))
    return {
      claimed: false,
      eligible: true,
      attempt: Number(row.attempt_count),
      maxAttempts: Number(row.max_attempts),
      postId: row.post_id,
      executionKey: row.execution_key,
    };
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE publish_jobs
     SET status = 'publishing',
         attempt_count = attempt_count + 1,
         first_claimed_at = COALESCE(first_claimed_at,?),
         claimed_at = ?,
         updated_at = ?
     WHERE id = ? AND status IN ('queued','retrying') AND attempt_count < max_attempts AND EXISTS (
       SELECT 1 FROM posts p JOIN clients c ON c.id=p.client_id
       WHERE p.id=publish_jobs.post_id AND c.status='active'
         AND publish_jobs.execution_key='post:' || p.id || ':publish:v' || p.publish_version
         AND p.status IN ('calendar_scheduled','pre_publish','rescheduled','publish_queued')
         AND p.platform_post_id IS NULL
         AND (? IS NULL OR EXISTS(SELECT 1 FROM campaigns ca WHERE ca.id=p.campaign_id AND ca.id=? AND ca.status='active' AND ca.workflow_revision=?))
         AND NOT EXISTS(SELECT 1 FROM social_publish_receipts r WHERE r.post_id=p.id AND r.status IN ('published','provider_processing'))
         AND (p.prepublish_response='publish_now' OR p.scheduled_publish_at IS NULL OR p.scheduled_publish_at<=?)
         AND EXISTS (SELECT 1 FROM pilot_settings cfg WHERE cfg.id='default' AND (
           cfg.mode='normal' OR (cfg.mode='supervised' AND cfg.ends_at>?
             AND cfg.revision=publish_jobs.pilot_revision AND p.prepublish_response='publish_now'
             AND EXISTS (SELECT 1 FROM users u WHERE u.id=publish_jobs.supervised_by AND u.role='owner' AND u.status='active')
             AND EXISTS (SELECT 1 FROM pilot_destinations d JOIN social_accounts s ON s.id=d.social_account_id
               WHERE d.client_id=p.client_id AND d.social_account_id=p.social_account_id AND s.client_id=p.client_id AND s.status='connected')
             AND (publish_jobs.first_claimed_at IS NOT NULL OR NOT EXISTS (
               SELECT 1 FROM publish_jobs other JOIN posts other_post ON other_post.id=other.post_id
               WHERE other_post.client_id=p.client_id AND other.id!=publish_jobs.id AND date(other.first_claimed_at)=date(?)))
           )
         )))`,
  )
    .bind(
      now,
      now,
      now,
      publishJobId,
      campaign?.id || null,
      campaign?.id || null,
      campaign?.workflow_revision ?? null,
      now,
      now,
      now,
    )
    .run();

  if (!result.meta.changes) {
    return {
      claimed: false,
      eligible: true,
      attempt: Number(row.attempt_count || 0),
      maxAttempts: Number(row.max_attempts || 3),
      postId: row.post_id,
      executionKey: row.execution_key,
    };
  }

  return {
    claimed: true,
    attempt: Number(row.attempt_count || 0) + 1,
    maxAttempts: Number(row.max_attempts || 3),
    postId: row.post_id,
    executionKey: row.execution_key,
  };
}

export async function markPublishJobRetry(env: PublishingEnv, publishJobId: string, error: string) {
  await env.DB.prepare(
    `UPDATE publish_jobs
     SET status = 'retrying', claimed_at = NULL, last_error = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(error, new Date().toISOString(), publishJobId)
    .run();
}

export async function markPublishJobFailed(
  env: PublishingEnv,
  publishJobId: string,
  error: string,
) {
  await env.DB.prepare(
    `UPDATE publish_jobs
     SET status = 'failed', last_error = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(error, new Date().toISOString(), new Date().toISOString(), publishJobId)
    .run();
}

export async function markPublishJobCompleted(env: PublishingEnv, publishJobId: string) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE publish_jobs
     SET status = 'completed', completed_at = ?, last_error = NULL, updated_at = ?
     WHERE id = ?`,
  )
    .bind(now, now, publishJobId)
    .run();
}

// The post transition and outbox cancellation share one transaction. A publisher
// that already owns its job wins; otherwise the version invalidates old messages.
export async function stopScheduledPost(
  env: PublishingEnv,
  postId: string,
  target: "paused" | "canceled",
  requireNoResponse = false,
  executionKey?: string,
) {
  const [changed] = await env.DB.batch([
    env.DB.prepare(`UPDATE posts SET paused_from_status=status,status=?,publish_version=publish_version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status IN ('calendar_scheduled','pre_publish','rescheduled','publish_queued')
        AND (?=0 OR prepublish_response IS NULL)
        AND (? IS NULL OR 'post:' || id || ':publish:v' || publish_version=?)
        AND NOT EXISTS(SELECT 1 FROM publish_jobs j WHERE j.post_id=posts.id AND j.status='publishing')`).bind(
      target,
      postId,
      requireNoResponse ? 1 : 0,
      executionKey || null,
      executionKey || null,
    ),
    env.DB.prepare(`UPDATE publish_jobs SET status='canceled',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE post_id=? AND status IN ('queued','retrying') AND EXISTS (SELECT 1 FROM posts p WHERE p.id=publish_jobs.post_id AND p.status=?)
        AND (? IS NULL OR execution_key=?)`).bind(
      postId,
      target,
      executionKey || null,
      executionKey || null,
    ),
  ]);
  return !!changed.meta.changes;
}

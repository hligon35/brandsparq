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
): Promise<{ jobId: string; executionKey: string; shouldEnqueue: boolean }> {
  const post = await env.DB.prepare("SELECT publish_version FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ publish_version: number }>();
  if (!post) throw new Error("Post not found while creating publish job.");

  const executionKey = `post:${postId}:publish:v${post.publish_version}`;
  const candidateId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO publish_jobs
     (id, post_id, execution_key, status, scheduled_for)
     VALUES (?, ?, ?, 'queued', ?)`,
  )
    .bind(candidateId, postId, executionKey, scheduledFor || null)
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

  if (!row) {
    throw new Error("Unable to create or resolve publish job.");
  }

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

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE publish_jobs
     SET status = 'publishing',
         attempt_count = attempt_count + 1,
         claimed_at = ?,
         updated_at = ?
     WHERE id = ? AND status IN ('queued','retrying') AND attempt_count < max_attempts AND EXISTS (
       SELECT 1 FROM posts p JOIN clients c ON c.id=p.client_id
       WHERE p.id=publish_jobs.post_id AND c.status='active'
         AND publish_jobs.execution_key='post:' || p.id || ':publish:v' || p.publish_version
         AND p.status IN ('calendar_scheduled','pre_publish','rescheduled','publish_queued')
         AND (p.prepublish_response='publish_now' OR p.scheduled_publish_at IS NULL OR p.scheduled_publish_at<=?))`,
  )
    .bind(now, now, publishJobId, now)
    .run();

  if (!result.meta.changes) {
    return {
      claimed: false,
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
) {
  const [changed] = await env.DB.batch([
    env.DB.prepare(`UPDATE posts SET paused_from_status=status,status=?,publish_version=publish_version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status IN ('calendar_scheduled','pre_publish','rescheduled','publish_queued')
        AND (?=0 OR prepublish_response IS NULL)
        AND NOT EXISTS(SELECT 1 FROM publish_jobs j WHERE j.post_id=posts.id AND j.status='publishing')`).bind(
      target,
      postId,
      requireNoResponse ? 1 : 0,
    ),
    env.DB.prepare(`UPDATE publish_jobs SET status='canceled',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE post_id=? AND status IN ('queued','retrying') AND EXISTS (SELECT 1 FROM posts p WHERE p.id=publish_jobs.post_id AND p.status=?)`).bind(
      postId,
      target,
    ),
  ]);
  return !!changed.meta.changes;
}

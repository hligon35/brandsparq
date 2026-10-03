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
  scheduledFor?: string | null
): Promise<{ jobId: string; executionKey: string; shouldEnqueue: boolean }> {
  const executionKey = `post:${postId}:publish:v1`;
  const candidateId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO publish_jobs
     (id, post_id, execution_key, status, scheduled_for)
     VALUES (?, ?, ?, 'queued', ?)`
  ).bind(
    candidateId,
    postId,
    executionKey,
    scheduledFor || null
  ).run();

  const row = await env.DB.prepare(
    `SELECT id, status, claimed_at
     FROM publish_jobs
     WHERE execution_key = ?`
  ).bind(executionKey).first<{
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
  publishJobId: string
): Promise<{
  claimed: boolean;
  attempt: number;
  maxAttempts: number;
  postId?: string;
  executionKey?: string;
}> {
  const row = await env.DB.prepare(
    `SELECT id, post_id, execution_key, status, attempt_count, max_attempts
     FROM publish_jobs WHERE id = ?`
  ).bind(publishJobId).first<any>();

  if (!row || !["queued","retrying"].includes(row.status)) {
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
     WHERE id = ? AND status IN ('queued','retrying')`
  ).bind(now, now, publishJobId).run();

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

export async function markPublishJobRetry(
  env: PublishingEnv,
  publishJobId: string,
  error: string
) {
  await env.DB.prepare(
    `UPDATE publish_jobs
     SET status = 'retrying', last_error = ?, updated_at = ?
     WHERE id = ?`
  ).bind(error, new Date().toISOString(), publishJobId).run();
}

export async function markPublishJobFailed(
  env: PublishingEnv,
  publishJobId: string,
  error: string
) {
  await env.DB.prepare(
    `UPDATE publish_jobs
     SET status = 'failed', last_error = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    error,
    new Date().toISOString(),
    new Date().toISOString(),
    publishJobId
  ).run();
}

export async function markPublishJobCompleted(
  env: PublishingEnv,
  publishJobId: string
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE publish_jobs
     SET status = 'completed', completed_at = ?, last_error = NULL, updated_at = ?
     WHERE id = ?`
  ).bind(now, now, publishJobId).run();
}

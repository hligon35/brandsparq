// The persisted queued job is the durable handoff. Duplicate queue deliveries
// share its claim. A send failure may be ambiguous: never overwrite a worker
// that already claimed or completed the job.
export async function dispatchGeneration(
  env: { DB: D1Database; GENERATION_QUEUE: Queue<any> },
  jobId: string,
  delaySeconds?: number,
) {
  const job = await env.DB.prepare("SELECT control_token FROM generation_jobs WHERE id=?")
    .bind(jobId)
    .first<{ control_token: string | null }>();
  if (!job) return false;
  try {
    await env.GENERATION_QUEUE.send(
      { kind: "generate", jobId },
      delaySeconds ? { delaySeconds } : undefined,
    );
    return true;
  } catch {
    const changed = await env.DB.prepare(`UPDATE generation_jobs SET status='failed',stage='failed',
      error_message='Unable to enqueue generation. Retry this job.',stage_updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='queued' AND claim_token IS NULL AND control_token IS ?`)
      .bind(jobId, job.control_token)
      .run();
    return !changed.meta.changes;
  }
}

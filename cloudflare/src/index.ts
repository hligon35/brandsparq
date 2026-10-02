interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  PUBLISH_QUEUE: Queue<PublishMessage>;
}

type PublishMessage = {
  postId: string;
  idempotencyKey: string;
};

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "brandsparq-api" });
    }

    if (request.method === "GET" && url.pathname === "/v1/posts/review") {
      const result = await env.DB.prepare(
        "SELECT * FROM posts WHERE status = ? ORDER BY suggested_publish_at ASC"
      )
        .bind("awaiting_approval")
        .all();
      return json({ data: result.results });
    }

    const approvalMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/approve$/);
    if (request.method === "POST" && approvalMatch) {
      const postId = approvalMatch[1];
      const now = new Date().toISOString();

      const post = await env.DB.prepare(
        "SELECT suggested_publish_at FROM posts WHERE id = ?"
      )
        .bind(postId)
        .first<{ suggested_publish_at: string | null }>();

      if (!post) return json({ error: "Post not found" }, { status: 404 });

      await env.DB.prepare(
        `UPDATE posts
         SET status = ?, approved_at = ?, scheduled_publish_at = suggested_publish_at, updated_at = ?
         WHERE id = ?`
      )
        .bind("calendar_scheduled", now, now, postId)
        .run();

      return json({ ok: true, postId, status: "calendar_scheduled" });
    }

    const publishNowMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/publish-now$/);
    if (request.method === "POST" && publishNowMatch) {
      const postId = publishNowMatch[1];
      const idempotencyKey = crypto.randomUUID();

      await env.PUBLISH_QUEUE.send({ postId, idempotencyKey });
      return json({ ok: true, queued: true, postId });
    }

    return json({ error: "Not found" }, { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const now = new Date().toISOString();
    const due = await env.DB.prepare(
      `SELECT id FROM posts
       WHERE status IN ('calendar_scheduled','rescheduled')
       AND scheduled_publish_at IS NOT NULL
       AND scheduled_publish_at <= ?
       ORDER BY scheduled_publish_at ASC
       LIMIT 100`
    )
      .bind(now)
      .all<{ id: string }>();

    for (const row of due.results) {
      await env.PUBLISH_QUEUE.send({
        postId: row.id,
        idempotencyKey: `scheduled:${row.id}:${now.slice(0, 16)}`,
      });
    }
  },

  async queue(batch: MessageBatch<PublishMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const existing = await env.DB.prepare(
        "SELECT id FROM publish_attempts WHERE idempotency_key = ?"
      )
        .bind(message.body.idempotencyKey)
        .first();

      if (existing) {
        message.ack();
        continue;
      }

      const attemptId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO publish_attempts
         (id, post_id, idempotency_key, status)
         VALUES (?, ?, ?, ?)`
      )
        .bind(attemptId, message.body.postId, message.body.idempotencyKey, "queued")
        .run();

      // Social platform adapters are wired in the next implementation phase.
      await env.DB.prepare(
        "UPDATE posts SET status = ?, updated_at = ? WHERE id = ?"
      )
        .bind("publishing", new Date().toISOString(), message.body.postId)
        .run();

      message.ack();
    }
  },
} satisfies ExportedHandler<Env, PublishMessage>;

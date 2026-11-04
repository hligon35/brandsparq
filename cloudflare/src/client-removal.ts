import type { SessionUser } from "./auth";
import { hasClientPermission } from "./authz";

export async function removeClient(
  db: D1Database,
  user: SessionUser,
  id: string,
  confirmation: unknown,
) {
  if (!(await hasClientPermission(db, user, "client_manage", id)))
    return { status: 403, body: { error: "Client management permission is required." } };
  const client = await db
    .prepare("SELECT name,status FROM clients WHERE id=?")
    .bind(id)
    .first<any>();
  if (!client || client.status === "removed")
    return { status: 404, body: { error: "Client not found." } };
  if (confirmation !== client.name)
    return {
      status: 409,
      body: { error: "Client details changed. Refresh before removing this client." },
    };
  const token = crypto.randomUUID(),
    now = new Date().toISOString();
  const fence = "EXISTS(SELECT 1 FROM clients WHERE id=? AND status='removed' AND edit_token=?)";
  const posts = "SELECT id FROM posts WHERE client_id=?";
  const scoped = (sql: string, ...values: unknown[]) =>
    db.prepare(sql + ` AND ${fence}`).bind(...values, id, token);
  const statements = [
    db
      .prepare(`UPDATE clients SET status='removed',archived_at=?,edit_token=?,edit_revision=edit_revision+1,schedule_revision=schedule_revision+1,updated_at=?
      WHERE id=? AND name=? AND status IN ('active','archived')
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.status='active' AND (u.role='owner' OR EXISTS(
        SELECT 1 FROM user_client_access a WHERE a.user_id=u.id AND a.client_id=clients.id AND COALESCE(a.permission_role,u.role) IN ('owner','admin'))))
      AND NOT EXISTS(SELECT 1 FROM posts p WHERE p.client_id=clients.id AND (p.status IN ('publishing','provider_processing','regenerating') OR p.failure_code='PUBLISH_OUTCOME_UNKNOWN'))
      AND NOT EXISTS(SELECT 1 FROM publish_jobs j JOIN posts p ON p.id=j.post_id WHERE p.client_id=clients.id AND j.status='publishing')
      AND NOT EXISTS(SELECT 1 FROM generation_jobs WHERE client_id=clients.id AND status='processing')
      AND NOT EXISTS(SELECT 1 FROM graphic_jobs g JOIN posts p ON p.id=g.post_id WHERE p.client_id=clients.id AND g.status='processing')
      AND NOT EXISTS(SELECT 1 FROM revision_jobs r JOIN posts p ON p.id=r.post_id WHERE p.client_id=clients.id AND r.status='processing')`)
      .bind(now, token, now, id, confirmation, user.id),
    scoped(
      `UPDATE publish_jobs SET status='canceled',completed_at=?,updated_at=? WHERE status IN ('queued','retrying') AND post_id IN (${posts})`,
      now,
      now,
      id,
    ),
    scoped(
      "UPDATE generation_jobs SET status='canceled',claim_token=NULL,control_token=?,stage_updated_at=? WHERE client_id=? AND status NOT IN ('completed','failed','canceled')",
      token,
      now,
      id,
    ),
    scoped(
      `UPDATE graphic_jobs SET status='canceled',updated_at=? WHERE status IN ('queued','retrying') AND post_id IN (${posts})`,
      now,
      id,
    ),
    scoped(
      `UPDATE revision_jobs SET status='failed',error_message='Client removed',updated_at=? WHERE status='queued' AND post_id IN (${posts})`,
      now,
      id,
    ),
    scoped(
      "UPDATE posts SET status='canceled',paused_from_status=NULL,publish_version=publish_version+1,updated_at=? WHERE client_id=? AND status NOT IN ('published','failed','canceled')",
      now,
      id,
    ),
    scoped(
      "UPDATE social_accounts SET status='disconnected',health_status='disconnected',permission_status='disconnected',connection_revision=connection_revision+1,refresh_claim=NULL,refresh_until=NULL,access_token_ciphertext=NULL,refresh_token_ciphertext=NULL,is_default=0,updated_at=? WHERE client_id=?",
      now,
      id,
    ),
    scoped(
      `UPDATE review_tokens SET revoked_at=?,expires_at=? WHERE post_id IN (${posts})`,
      Date.now(),
      0,
      id,
    ),
    scoped(`UPDATE media_access_tokens SET expires_at=0 WHERE post_id IN (${posts})`, id),
    scoped(`UPDATE publish_media_tokens SET expires_at=0 WHERE post_id IN (${posts})`, id),
    scoped(
      "UPDATE social_oauth_states SET consumed_at=?,expires_at=0 WHERE client_id=? AND consumed_at IS NULL",
      Date.now(),
      id,
    ),
    scoped("UPDATE client_reviewers SET enabled=0 WHERE client_id=?", id),
    scoped(
      `UPDATE notifications SET status='canceled' WHERE status IN ('queued','retrying') AND post_id IN (${posts})`,
      id,
    ),
    scoped("DELETE FROM user_client_access WHERE client_id=?", id),
    db
      .prepare(`INSERT INTO recovery_actions(id,actor_user_id,action,entity_type,entity_id,metadata_json)
      SELECT ?,?,'remove_client','client',?,? WHERE ${fence}`)
      .bind(
        crypto.randomUUID(),
        user.id,
        id,
        JSON.stringify({ name: client.name, retainedHistory: true }),
        id,
        token,
      ),
  ];
  const [changed] = await db.batch(statements);
  return changed.meta.changes
    ? { body: { ok: true } }
    : {
        status: 409,
        body: {
          error:
            "Client changed or has active/uncertain publishing or generation. Resolve running work and refresh before removal.",
        },
      };
}

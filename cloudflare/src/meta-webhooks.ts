import { verifySocialAccount, type SocialEnv } from "./social";
type Env = SocialEnv & { GENERATION_QUEUE?: Queue<any> };

export async function dispatchMetaWebhook(env: Env, eventId: string) {
  try {
    await env.GENERATION_QUEUE?.send({ kind: "meta_webhook", eventId });
  } catch {
    /* The durable inbox is recovered by maintenance. */
  }
}

// Signed notifications are hints to re-check stored account identity with Meta.
// Never treat arbitrary event values as permission to publish or reconnect.
export async function processMetaWebhook(env: Env, eventId: string) {
  const claim = crypto.randomUUID();
  const changed =
    await env.DB.prepare(`UPDATE social_webhook_events SET claim_token=?,claim_until=?,attempt_count=attempt_count+1
    WHERE id=? AND processing_status='pending' AND attempt_count<5 AND (claim_until IS NULL OR claim_until<?)`)
      .bind(claim, Date.now() + 900000, eventId, Date.now())
      .run();
  if (!changed.meta.changes) return;
  try {
    const event = await env.DB.prepare(
      "SELECT payload_json,processing_cursor FROM social_webhook_events WHERE id=?",
    )
      .bind(eventId)
      .first<{ payload_json: string; processing_cursor: string | null }>();
    const payload = JSON.parse(event!.payload_json);
    const platform =
      payload.object === "page" ? "facebook" : payload.object === "instagram" ? "instagram" : null;
    const ids = [
      ...new Set<string>(
        (payload.entry || [])
          .map((e: any) => (typeof e?.id === "string" ? e.id : ""))
          .filter(Boolean),
      ),
    ];
    let matched = 0;
    let more = false;
    let last = event!.processing_cursor || "";
    if (platform && ids.length) {
      const accounts =
        await env.DB.prepare(`SELECT sa.id FROM social_accounts sa JOIN clients c ON c.id=sa.client_id
        WHERE sa.platform=? AND sa.external_account_id IN (SELECT value FROM json_each(?)) AND sa.status='connected' AND c.status='active' AND sa.id>? ORDER BY sa.id LIMIT 11`)
          .bind(platform, JSON.stringify(ids), last)
          .all<{ id: string }>();
      more = accounts.results.length > 10;
      for (const account of accounts.results.slice(0, 10)) {
        await verifySocialAccount(env, account.id);
        matched++;
        last = account.id;
      }
    }
    const progress = await env.DB.prepare(
      `UPDATE social_webhook_events SET processing_status=?,processed_at=CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP END,
       processing_cursor=?,attempt_count=CASE WHEN ? THEN 0 ELSE attempt_count END,processing_error=NULL,claim_token=NULL,claim_until=NULL WHERE id=? AND claim_token=?`,
    )
      .bind(
        more ? "pending" : matched || last ? "completed" : "ignored",
        more ? 1 : 0,
        last,
        more ? 1 : 0,
        eventId,
        claim,
      )
      .run();
    if (more && progress.meta.changes) await dispatchMetaWebhook(env, eventId);
  } catch {
    await env.DB.prepare(`UPDATE social_webhook_events SET processing_status=CASE WHEN attempt_count>=5 THEN 'failed' ELSE 'pending' END,
      processing_error='Account reconciliation failed. Verify connections and retry this webhook.',claim_token=NULL,claim_until=? WHERE id=? AND claim_token=?`)
      .bind(Date.now() + 60000, eventId, claim)
      .run();
  }
}
export async function recoverMetaWebhooks(env: Env) {
  // A worker may die on its last attempt before recording a terminal failure.
  await env.DB.prepare(`UPDATE social_webhook_events SET processing_status='failed',claim_token=NULL,claim_until=NULL,
    processing_error='Webhook processing was interrupted on its final attempt. Retry from System Health.'
    WHERE processing_status='pending' AND attempt_count>=5 AND (claim_until IS NULL OR claim_until<=?)`)
    .bind(Date.now())
    .run();
  const rows =
    await env.DB.prepare(`SELECT id FROM social_webhook_events WHERE processing_status='pending' AND attempt_count<5
    AND (claim_until IS NULL OR claim_until<?) ORDER BY created_at,id LIMIT 20`)
      .bind(Date.now())
      .all<{ id: string }>();
  for (const row of rows.results) await dispatchMetaWebhook(env, row.id);
}

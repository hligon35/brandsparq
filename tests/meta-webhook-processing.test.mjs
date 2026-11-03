import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { workspace } from "./workspace.mjs";
import { handleMetaWebhook } from "../cloudflare/src/social.ts";
import { processMetaWebhook, recoverMetaWebhooks } from "../cloudflare/src/meta-webhooks.ts";
import { encryptSecret } from "../cloudflare/src/security.ts";
async function receive(w, payload) {
  w.env.META_APP_SECRET = "secret";
  const body = JSON.stringify(payload),
    url = new URL(w.env.PUBLIC_BASE_URL + "/v1/social/webhooks/meta");
  return handleMetaWebhook(
    w.env,
    new Request(url, {
      method: "POST",
      body,
      headers: {
        "x-hub-signature-256":
          "sha256=" + createHmac("sha256", "secret").update(body).digest("hex"),
      },
    }),
    url,
  );
}
const payload = {
  object: "instagram",
  entry: [{ id: "external", changes: [{ field: "comments" }] }],
};
test("signed deliveries durably reconcile matching accounts once and refresh profile photos", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,access_token_ciphertext) VALUES('ig','client-a','instagram','external','connected',?)",
    await encryptSecret("token", w.env),
  );
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ id: "external", profile_picture_url: "https://example.test/new.png" });
  });
  assert.equal((await receive(w, payload)).status, 200);
  const event = w.row("SELECT * FROM social_webhook_events");
  assert.equal(event.processed_at, null);
  await Promise.all([processMetaWebhook(w.env, event.id), processMetaWebhook(w.env, event.id)]);
  assert.equal(calls, 1);
  assert.equal(
    w.row("SELECT processing_status FROM social_webhook_events").processing_status,
    "completed",
  );
  assert.match(w.row("SELECT metadata FROM social_accounts WHERE id='ig'").metadata, /new.png/);
  await receive(w, payload);
  await processMetaWebhook(w.env, event.id);
  assert.equal(calls, 1);
});
test("queue failure recovers and unmatched notifications are explicitly ignored", async (t) => {
  const w = workspace(t);
  w.env.GENERATION_QUEUE.send = async () => {
    throw new Error("offline");
  };
  assert.equal((await receive(w, payload)).status, 200);
  const event = w.row("SELECT * FROM social_webhook_events");
  const sent = [];
  w.env.GENERATION_QUEUE.send = async (m) => sent.push(m);
  await recoverMetaWebhooks(w.env);
  assert.equal(sent[0].eventId, event.id);
  await processMetaWebhook(w.env, event.id);
  assert.equal(
    w.row("SELECT processing_status FROM social_webhook_events").processing_status,
    "ignored",
  );
});
test("failed provider checks retry finitely and only owners can restart failed jobs", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,access_token_ciphertext) VALUES('ig','client-a','instagram','external','connected',?)",
    await encryptSecret("token", w.env),
  );
  t.mock.method(globalThis, "fetch", async () => new Response("busy", { status: 503 }));
  await receive(w, payload);
  const event = w.row("SELECT id FROM social_webhook_events");
  for (let i = 0; i < 5; i++) {
    w.exec("UPDATE social_webhook_events SET claim_until=NULL");
    await processMetaWebhook(w.env, event.id);
  }
  assert.equal(
    w.row("SELECT processing_status FROM social_webhook_events").processing_status,
    "failed",
  );
  assert.equal((await w.request("/v1/social/webhook-events", { user: "viewer" })).status, 403);
  const path = "/v1/social/webhook-events/" + event.id + "/retry";
  assert.equal((await w.request(path, { user: "viewer", method: "POST" })).status, 403);
  assert.equal((await w.request(path, { user: "owner", method: "POST" })).status, 202);
  assert.equal(w.row("SELECT attempt_count FROM social_webhook_events").attempt_count, 0);
  const list = await (await w.request("/v1/social/webhook-events", { user: "owner" })).json();
  assert.equal(list.data[0].payload_json, undefined);
});

test("large webhook deliveries advance durable batches without repeating completed accounts", async (t) => {
  const w = workspace(t),
    entries = [];
  for (let i = 0; i < 23; i++) {
    const id = String(i).padStart(3, "0");
    entries.push({ id: "external-" + id });
    w.exec(
      "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,access_token_ciphertext) VALUES(?,'client-a','instagram',?,'connected',?)",
      id,
      "external-" + id,
      await encryptSecret("token", w.env),
    );
  }
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    calls.push(new URL(input).pathname);
    return Response.json({ id: "verified" });
  });
  await receive(w, { object: "instagram", entry: entries });
  const event = w.row("SELECT id FROM social_webhook_events");
  await processMetaWebhook(w.env, event.id);
  assert.equal(calls.length, 10);
  assert.equal(
    w.row("SELECT processing_status FROM social_webhook_events").processing_status,
    "pending",
  );
  await processMetaWebhook(w.env, event.id);
  assert.equal(calls.length, 20);
  await processMetaWebhook(w.env, event.id);
  assert.equal(calls.length, 23);
  assert.equal(new Set(calls).size, 23);
  assert.equal(
    w.row("SELECT processing_status FROM social_webhook_events").processing_status,
    "completed",
  );
});
test("a crash on the final claim becomes an actionable failure only after its lease expires", async (t) => {
  const w = workspace(t);
  await receive(w, payload);
  const event = w.row("SELECT id FROM social_webhook_events");
  w.exec(
    "UPDATE social_webhook_events SET attempt_count=5,claim_token='dead-worker',claim_until=?",
    Date.now() + 60000,
  );
  await recoverMetaWebhooks(w.env);
  assert.equal(
    w.row("SELECT processing_status FROM social_webhook_events").processing_status,
    "pending",
  );
  w.exec("UPDATE social_webhook_events SET claim_until=?", Date.now() - 1);
  await recoverMetaWebhooks(w.env);
  const failed = w.row("SELECT * FROM social_webhook_events");
  assert.equal(failed.processing_status, "failed");
  assert.equal(failed.claim_token, null);
  assert.equal(
    (
      await w.request("/v1/social/webhook-events/" + event.id + "/retry", {
        user: "owner",
        method: "POST",
      })
    ).status,
    202,
  );
});

test("oversized webhook streams are rejected before persistence without trusting content length", async (t) => {
  const w = workspace(t);
  w.env.META_APP_SECRET = "secret";
  const url = new URL(w.env.PUBLIC_BASE_URL + "/v1/social/webhooks/meta");
  const result = await handleMetaWebhook(
    w.env,
    new Request(url, { method: "POST", body: "x".repeat(262145) }),
    url,
  );
  assert.equal(result.status, 413);
  assert.equal(w.row("SELECT COUNT(*) n FROM social_webhook_events").n, 0);
});

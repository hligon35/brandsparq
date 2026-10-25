import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { workspace } from "./workspace.mjs";
import { handleMetaWebhook } from "../cloudflare/src/social.ts";
import { UNRESOLVED_PUBLISHING_SQL } from "../scripts/lib/production-preflight.mjs";

test("Meta rejects missing configuration, unsigned/tampered requests and signed malformed payloads without recording them", async (t) => {
  const w = workspace(t);
  const url = new URL(w.env.PUBLIC_BASE_URL + "/v1/social/webhooks/meta");
  const call = (body, signature = "") =>
    handleMetaWebhook(
      w.env,
      new Request(url, {
        method: "POST",
        body,
        headers: { "x-hub-signature-256": signature },
      }),
      url,
    );
  assert.equal((await call("{}")).status, 503);
  w.env.META_APP_SECRET = "fixture-secret";
  const sign = (body) =>
    "sha256=" + createHmac("sha256", w.env.META_APP_SECRET).update(body).digest("hex");
  assert.equal((await call("{}")).status, 401);
  assert.equal((await call('{"entry":[]}', sign("{}"))).status, 401);
  for (const body of ["broken", "null", "[]", "{}"])
    assert.equal((await call(body, sign(body))).status, 400);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM social_webhook_events").n, 0);
});

test("Meta deduplicates simultaneous identical deliveries without dropping batches sharing a first entry", async (t) => {
  const w = workspace(t);
  w.env.META_APP_SECRET = "fixture-secret";
  const url = new URL(w.env.PUBLIC_BASE_URL + "/v1/social/webhooks/meta");
  const call = (entries) => {
    const body = JSON.stringify({ object: "page", entry: entries });
    const signature =
      "sha256=" + createHmac("sha256", w.env.META_APP_SECRET).update(body).digest("hex");
    return handleMetaWebhook(
      w.env,
      new Request(url, { method: "POST", body, headers: { "x-hub-signature-256": signature } }),
      url,
    );
  };
  const first = { id: "page", time: 1, changes: [{ value: "first" }] };
  const responses = await Promise.all([call([first]), call([first])]);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(w.row("SELECT COUNT(*) AS n FROM social_webhook_events").n, 1);
  assert.equal((await call([first, { id: "page", time: 2 }])).status, 200);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM social_webhook_events").n, 2);
});

test("production preflight counts asynchronous and unknown outcomes after a queue job completes", (t) => {
  const w = workspace(t);
  w.post("pending", "client-a", "provider_processing");
  w.post("unknown", "client-a", "failed");
  w.exec("UPDATE posts SET failure_code='PUBLISH_OUTCOME_UNKNOWN' WHERE id='unknown'");
  assert.equal(w.row(UNRESOLVED_PUBLISHING_SQL).in_flight, 2);
  w.exec("UPDATE posts SET status='published',failure_code=NULL");
  assert.equal(w.row(UNRESOLVED_PUBLISHING_SQL).in_flight, 0);
});

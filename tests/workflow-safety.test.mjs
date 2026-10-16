import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/src/index.ts";
import { workspace } from "./workspace.mjs";
import { encryptSecret, decryptSecret } from "../cloudflare/src/security.ts";
import { runGenerationJob } from "../cloudflare/src/generation.ts";
import { publishPostToSocial, checkPublishReceipt } from "../cloudflare/src/social.ts";
import { notifyPostOwners, retryNotificationDeliveries } from "../cloudflare/src/notifications.ts";

async function queued(t) {
  const w = workspace(t);
  w.post("publish", "client-a", "calendar_scheduled");
  w.objects.set("graphic.jpg", "fixture");
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,access_token_ciphertext) VALUES ('social','client-a','facebook','fixture-page','connected',?)",
    await encryptSecret("fixture", w.env),
  );
  w.exec(
    "UPDATE posts SET social_account_id='social',graphic_key='graphic.jpg' WHERE id='publish'",
  );
  assert.equal(
    (await w.request("/v1/posts/publish/publish-now", { user: "owner", method: "POST" })).status,
    200,
  );
  return w;
}
function message(w, attempts = 1) {
  return {
    body: w.published[0],
    attempts,
    ack() {},
    retry() {
      throw new Error("Unexpected publishing retry");
    },
  };
}

test("social OAuth starts only through authenticated, authorized POST and returns a provider URL", async (t) => {
  const w = workspace(t);
  w.env.META_APP_ID = "fixture-app";
  w.env.META_APP_SECRET = "fixture-secret";
  const body = {
    platform: "facebook",
    clientId: "client-a",
    returnTo: w.env.PUBLIC_BASE_URL + "/social",
  };
  assert.equal((await w.request("/v1/social/connect", { method: "POST", body })).status, 401);
  assert.equal(
    (await w.request("/v1/social/connect", { user: "viewer", method: "POST", body })).status,
    403,
  );
  const response = await w.request("/v1/social/connect", { user: "owner", method: "POST", body });
  assert.equal(response.status, 200);
  const url = new URL((await response.json()).authorizationUrl);
  assert.equal(url.hostname, "www.facebook.com");
  assert.ok(url.searchParams.get("state"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await w.request("/v1/social/connect", { user: "owner" })).status, 404);
  assert.equal(
    (
      await w.request("/v1/social/connect", {
        user: "owner",
        method: "POST",
        body: { ...body, returnTo: "https://stranger.example" },
      })
    ).status,
    400,
  );
});

test("private responses, handoffs and unauthorized failures are never cacheable", async (t) => {
  const w = workspace(t);
  for (const [path, opts] of [
    ["/v1/clients", { user: "owner" }],
    ["/v1/auth/session", {}],
    ["/v1/auth/google/complete", { method: "POST", body: { handoff: "invalid" } }],
  ]) {
    assert.equal((await w.request(path, opts)).headers.get("cache-control"), "no-store");
  }
});

test("notification network failures retry delivery alone and never republish", async (t) => {
  const w = await queued(t);
  let publishes = 0;
  const emailKeys = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.startsWith("https://graph.facebook.com/")) {
      publishes++;
      return Response.json({ post_id: "published" });
    }
    emailKeys.push(init.headers["idempotency-key"]);
    throw new Error("Email network unavailable");
  });
  await worker.queue({ messages: [message(w)] }, w.env);
  assert.equal(w.row("SELECT status FROM posts WHERE id='publish'").status, "published");
  assert.equal(w.row("SELECT status FROM publish_jobs").status, "completed");
  assert.equal(
    w.row("SELECT status FROM notification_deliveries WHERE channel='email'").status,
    "failed",
  );
  w.exec("UPDATE notification_deliveries SET retry_at='2000-01-01T00:00:00.000Z'");
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    emailKeys.push(init.headers["idempotency-key"]);
    return Response.json({ id: "email" });
  });
  await Promise.all([retryNotificationDeliveries(w.env), retryNotificationDeliveries(w.env)]);
  await worker.queue({ messages: [message(w, 2)] }, w.env);
  assert.equal(publishes, 1);
  assert.equal(emailKeys.length, 2);
  assert.equal(emailKeys[0], emailKeys[1]);
  assert.equal(
    w.row("SELECT status,attempt_count FROM notification_deliveries WHERE channel='email'")
      .attempt_count,
    2,
  );
  assert.equal(w.row("SELECT status FROM notifications WHERE type='published'").status, "sent");
});

test("unknown provider outcomes block automatic and owner retries", async (t) => {
  const w = await queued(t);
  let publishes = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.startsWith("https://graph.facebook.com/")) {
      publishes++;
      throw new Error("Response lost after submission");
    }
    return Response.json({ id: "email" });
  });
  await worker.queue({ messages: [message(w)] }, w.env);
  assert.equal(
    w.row("SELECT failure_code FROM posts WHERE id='publish'").failure_code,
    "PUBLISH_OUTCOME_UNKNOWN",
  );
  await worker.queue({ messages: [message(w, 2)] }, w.env);
  assert.equal(publishes, 1);
  assert.equal(
    (await w.request("/v1/system/posts/publish/retry", { user: "owner", method: "POST" })).status,
    409,
  );
});

test("notification recipients, history and read actions honor current client assignments", async (t) => {
  const w = workspace(t);
  w.post("private");
  w.exec("INSERT INTO users(id,email,role) VALUES ('admin','admin@example.test','admin')");
  w.exec("INSERT INTO user_client_access(user_id,client_id) VALUES ('admin','client-b')");
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "email" }));
  await notifyPostOwners(w.env, "private", "published", "Private A", "Client A");
  assert.equal(w.row("SELECT COUNT(*) AS n FROM notifications WHERE user_id='admin'").n, 0);
  w.exec(
    "INSERT INTO notifications(id,user_id,post_id,type,channel,status,title,body) VALUES ('legacy','viewer','private','published','in_app','sent','Private','Old notice')",
  );
  w.exec("DELETE FROM user_client_access WHERE user_id='viewer'");
  assert.deepEqual(
    (await (await w.request("/v1/notifications", { user: "viewer" })).json()).data,
    [],
  );
  await w.request("/v1/notifications/legacy/read", { user: "viewer", method: "POST" });
  await w.request("/v1/notifications/read-all", { user: "viewer", method: "POST" });
  assert.equal(w.row("SELECT read_at FROM notifications WHERE id='legacy'").read_at, null);
});

test("delivery retry suppresses revoked access instead of sending private content", async (t) => {
  const w = workspace(t);
  w.post("private");
  w.exec("UPDATE users SET role='admin' WHERE id='viewer'");
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unavailable");
  });
  await notifyPostOwners(w.env, "private", "published", "Private", "Client A");
  w.exec("DELETE FROM user_client_access WHERE user_id='viewer'");
  w.exec(
    "UPDATE notification_deliveries SET retry_at='2000-01-01' WHERE notification_id IN (SELECT id FROM notifications WHERE user_id='viewer')",
  );
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ id: "email" });
  });
  await retryNotificationDeliveries(w.env);
  assert.equal(calls, 0);
  assert.equal(
    w.row(
      "SELECT d.status FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.user_id='viewer' AND d.channel='email'",
    ).status,
    "suppressed",
  );
});

test("publishing and receipt polling save rotated credentials on the social account", async (t) => {
  const w = workspace(t);
  w.post("refresh", "client-a", "publishing");
  w.objects.set("graphic.jpg", "image");
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,access_token_ciphertext,refresh_token_ciphertext,token_expires_at) VALUES ('social','client-a','tiktok','creator','connected',?,?,?)",
    await encryptSecret("old", w.env),
    await encryptSecret("refresh", w.env),
    Date.now() - 1,
  );
  w.exec(
    "UPDATE posts SET platform='tiktok',social_account_id='social',graphic_key='graphic.jpg' WHERE id='refresh'",
  );
  let count = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.includes("/oauth/token"))
      return Response.json({
        access_token: "new-" + ++count,
        refresh_token: "refresh-" + count,
        expires_in: 3600,
      });
    if (url.includes("/status/fetch")) return Response.json({ data: { status: "PROCESSING" } });
    return Response.json({ data: { publish_id: "receipt" }, error: { code: "ok" } });
  });
  const result = await publishPostToSocial(w.env, "refresh");
  assert.equal(
    await decryptSecret(
      w.row("SELECT access_token_ciphertext FROM social_accounts WHERE id='social'")
        .access_token_ciphertext,
      w.env,
    ),
    "new-1",
  );
  w.exec("UPDATE social_accounts SET token_expires_at=1 WHERE id='social'");
  await checkPublishReceipt(w.env, result.receiptId);
  assert.equal(
    await decryptSecret(
      w.row("SELECT access_token_ciphertext FROM social_accounts WHERE id='social'")
        .access_token_ciphertext,
      w.env,
    ),
    "new-2",
  );
  assert.equal(
    await decryptSecret(
      w.row("SELECT refresh_token_ciphertext FROM social_accounts WHERE id='social'")
        .refresh_token_ciphertext,
      w.env,
    ),
    "refresh-2",
  );
});

test("concurrent generation creates one campaign and retries resume the same plan", async (t) => {
  const w = workspace(t);
  const plan = {
    campaignName: "One campaign",
    posts: [
      {
        platform: "facebook",
        headline: "One",
        caption: "Copy",
        hashtags: [],
        objective: "Awareness",
        cta: "Learn more",
        visualDirection: "Simple",
        suggestedPublishAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ],
  };
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status,plan_json) VALUES ('job','client-a','[]','queued',?)",
    JSON.stringify(plan),
  );
  await Promise.all([runGenerationJob(w.env, "job"), runGenerationJob(w.env, "job")]);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM campaigns").n, 1);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM posts WHERE generation_job_id='job'").n, 1);
  w.exec("UPDATE generation_jobs SET status='retrying' WHERE id='job'");
  await runGenerationJob(w.env, "job");
  assert.equal(w.row("SELECT COUNT(*) AS n FROM campaigns").n, 1);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM posts WHERE generation_job_id='job'").n, 1);
});

test("all AI mutations reject terminal or scheduled posts before provider calls", async (t) => {
  const w = workspace(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Must not contact provider");
  });
  for (const status of [
    "published",
    "publishing",
    "provider_processing",
    "calendar_scheduled",
    "paused",
    "canceled",
  ]) {
    w.post(status, "client-a", status);
    for (const action of ["ai-rewrite-caption", "ai-edit-image", "ai-regenerate"]) {
      assert.equal(
        (
          await w.request(`/v1/posts/${status}/${action}`, {
            user: "owner",
            method: "POST",
            body: { instruction: "Change" },
          })
        ).status,
        409,
      );
    }
    assert.equal(w.row("SELECT status FROM posts WHERE id=?", status).status, status);
  }
  assert.equal(calls, 0);
});

test("AI revision holds a claim through the provider call and restores review on failure", async (t) => {
  const w = workspace(t);
  w.post("edit");
  let release;
  t.mock.method(
    globalThis,
    "fetch",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = w.request("/v1/posts/edit/ai-rewrite-caption", {
    user: "owner",
    method: "POST",
    body: {},
  });
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await w.request("/v1/posts/edit/ai-regenerate", { user: "owner", method: "POST", body: {} }))
      .status,
    409,
  );
  assert.equal(
    (await w.request("/v1/posts/edit/approve", { user: "owner", method: "POST" })).status,
    409,
  );
  release(
    Response.json({
      output_text: JSON.stringify({ headline: "New", caption: "Updated", hashtags: [] }),
    }),
  );
  assert.equal((await first).status, 200);
  assert.equal(w.row("SELECT status FROM posts WHERE id='edit'").status, "awaiting_approval");
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("AI failed");
  });
  assert.equal(
    (
      await w.request("/v1/posts/edit/ai-rewrite-caption", {
        user: "owner",
        method: "POST",
        body: {},
      })
    ).status,
    502,
  );
  assert.equal(w.row("SELECT status FROM posts WHERE id='edit'").status, "edit_requested");
});

test("archiving cancels queued publishing, revokes review links and blocks new work", async (t) => {
  const w = await queued(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Archived client must not publish");
  });
  assert.equal(
    (await w.request("/v1/clients/client-a/archive", { user: "owner", method: "POST" })).status,
    200,
  );
  await worker.queue({ messages: [message(w)] }, w.env);
  assert.equal(calls, 0);
  assert.equal(w.row("SELECT status FROM publish_jobs").status, "canceled");
  assert.equal(w.row("SELECT status FROM posts WHERE id='publish'").status, "paused");
  assert.equal(
    (await w.request("/v1/posts/publish/publish-now", { user: "owner", method: "POST" })).status,
    403,
  );
  assert.equal(
    (
      await w.request("/v1/clients/client-a/brand", {
        user: "owner",
        method: "POST",
        body: { voice: "No" },
      })
    ).status,
    403,
  );
});

test("archiving waits for in-flight publication and stale version jobs cannot publish", async (t) => {
  const w = await queued(t);
  w.exec("UPDATE posts SET status='publishing' WHERE id='publish'");
  assert.equal(
    (await w.request("/v1/clients/client-a/archive", { user: "owner", method: "POST" })).status,
    409,
  );
  assert.equal(w.row("SELECT status FROM clients WHERE id='client-a'").status, "active");
  w.exec(
    "UPDATE posts SET status='publish_queued',publish_version=publish_version+1 WHERE id='publish'",
  );
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Stale job must not publish");
  });
  await worker.queue({ messages: [message(w)] }, w.env);
  assert.equal(w.row("SELECT status FROM posts WHERE id='publish'").status, "publish_queued");
});

test("saving a provider receipt failure is held for reconciliation, not a second publish", async (t) => {
  const w = await queued(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.startsWith("https://graph.facebook.com/")) {
      calls++;
      return Response.json({ post_id: "already-live" });
    }
    return Response.json({ id: "email" });
  });
  const originalBatch = w.env.DB.batch;
  let batches = 0;
  t.mock.method(w.env.DB, "batch", async (statements) => {
    if (++batches === 2) throw new Error("Receipt persistence unavailable");
    return originalBatch(statements);
  });
  await worker.queue({ messages: [message(w)] }, w.env);
  assert.equal(
    w.row("SELECT failure_code FROM posts WHERE id='publish'").failure_code,
    "PUBLISH_OUTCOME_UNKNOWN",
  );
  await worker.queue({ messages: [message(w, 2)] }, w.env);
  assert.equal(calls, 1);
});

test("approval cannot overwrite an AI claim won after scheduling validation", async (t) => {
  const w = workspace(t);
  w.post("approve");
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,status,is_default) VALUES ('social','client-a','facebook','connected',1)",
  );
  w.exec("UPDATE posts SET social_account_id='social' WHERE id='approve'");
  const batch = w.env.DB.batch;
  t.mock.method(w.env.DB, "batch", async (statements) => {
    w.exec("UPDATE posts SET status='regenerating' WHERE id='approve'");
    return batch(statements);
  });
  assert.equal(
    (await w.request("/v1/posts/approve/approve", { user: "owner", method: "POST" })).status,
    409,
  );
  assert.equal(w.row("SELECT status FROM posts WHERE id='approve'").status, "regenerating");
  assert.equal(w.row("SELECT COUNT(*) AS n FROM approvals").n, 0);
});

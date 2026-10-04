import test from "node:test";
import assert from "node:assert/strict";
import { workspace, digest } from "./workspace.mjs";
import {
  ensurePublishJob,
  claimPublishJob,
  markPublishJobRetry,
  markPublishJobCompleted,
} from "../cloudflare/src/publishing.ts";
import { findNextAvailableSlot } from "../cloudflare/src/scheduling.ts";
import { checkExpoPushReceipts } from "../cloudflare/src/notifications.ts";
import { runLaunchCertification, recordSystemEvent } from "../cloudflare/src/operations.ts";

// Every test applies all production migrations to a fresh SQLite database.
// Network providers are stubbed; no real messages or posts are sent.
test("health hides diagnostics and reports missing production configuration", async (t) => {
  const w = workspace(t);
  assert.equal((await w.request("/health")).status, 200);
  delete w.env.AUTH_PEPPER;
  const response = await w.request("/health");
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(
    payload.checks.some((check) => "detail" in check),
    false,
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("production CORS permits same origin and explicit origins, rejects localhost and strangers", async (t) => {
  const w = workspace(t);
  for (const origin of ["https://untrusted.example", "http://localhost:3000"]) {
    assert.equal((await w.request("/v1/dashboard", { method: "OPTIONS", origin })).status, 403);
    assert.equal((await w.request("/v1/dashboard", { user: "owner", origin })).status, 403);
  }
  w.env.ALLOWED_ORIGINS = "https://trusted.example";
  for (const origin of [w.env.PUBLIC_BASE_URL, "https://trusted.example"]) {
    const response = await w.request("/v1/dashboard", { user: "owner", origin });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }
  w.env.ENVIRONMENT = "development";
  assert.equal(
    (await w.request("/v1/dashboard", { method: "OPTIONS", origin: "http://localhost:3000" }))
      .status,
    204,
  );
});

test("protected routes reject missing, expired and revoked sessions; logout revokes access", async (t) => {
  const w = workspace(t);
  for (const path of ["/v1/dashboard", "/v1/clients", "/v1/analytics/overview", "/v1/posts"]) {
    assert.equal((await w.request(path)).status, 401);
  }
  assert.equal((await w.request("/v1/auth/session", { user: "owner" })).status, 200);
  w.exec("UPDATE sessions SET expires_at=0 WHERE id=?", "viewer");
  assert.equal((await w.request("/v1/auth/session", { user: "viewer" })).status, 401);
  assert.equal((await w.request("/v1/auth/logout", { user: "owner", method: "POST" })).status, 200);
  assert.equal((await w.request("/v1/dashboard", { user: "owner" })).status, 401);
});

test("OAuth handoff is atomically single-use under simultaneous requests", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO google_auth_handoffs(id,user_id,handoff_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
    "handoff",
    "owner",
    digest(`${w.env.AUTH_PEPPER}:google-handoff:secret`),
    Date.now() + 60000,
    Date.now(),
  );
  const responses = await Promise.all(
    Array.from({ length: 4 }, () =>
      w.request("/v1/auth/google/complete", { method: "POST", body: { handoff: "secret" } }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401, 401, 401]);
  assert.equal(w.row("SELECT COUNT(*) AS count FROM sessions").count, 3);
});

test("client permissions filter listings and prevent viewer mutations and cross-client reads", async (t) => {
  const w = workspace(t);
  w.post("visible");
  w.post("hidden", "client-b");
  const payload = await (await w.request("/v1/posts/review", { user: "viewer" })).json();
  assert.deepEqual(
    payload.data.map((p) => p.id),
    ["visible"],
  );
  assert.equal((await w.request("/v1/posts/hidden", { user: "viewer" })).status, 403);
  assert.equal(
    (await w.request("/v1/posts/visible/approve", { user: "viewer", method: "POST" })).status,
    403,
  );
  assert.equal(
    (
      await w.request("/v1/clients/client-a/brand", {
        user: "viewer",
        method: "POST",
        body: { voice: "New" },
      })
    ).status,
    403,
  );
});

test("raw media requires client ownership for source, derivative and generated graphics", async (t) => {
  const w = workspace(t);
  w.post("hidden", "client-b");
  w.exec(
    "INSERT INTO assets(id,client_id,r2_key,filename,content_type) VALUES ('asset','client-b','client-b/source.jpg','source.jpg','image/jpeg')",
  );
  w.exec(
    "INSERT INTO asset_derivatives(id,asset_id,kind,r2_key,content_type) VALUES ('derivative','asset','preview','client-b/preview.jpg','image/jpeg')",
  );
  w.exec("UPDATE posts SET graphic_key='client-b/generated.jpg' WHERE id='hidden'");
  w.exec(
    "INSERT INTO creative_variants(id,post_id,platform,variant_key,aspect_ratio,r2_key) VALUES ('variant','hidden','facebook','square','1:1','client-b/variant.jpg')",
  );
  for (const key of [
    "client-b/source.jpg",
    "client-b/preview.jpg",
    "client-b/generated.jpg",
    "client-b/variant.jpg",
  ]) {
    w.objects.set(key, "private image");
    assert.equal((await w.request(`/v1/media/${key}`, { user: "viewer" })).status, 404);
    assert.equal((await w.request(`/v1/media/${key}`, { user: "owner" })).status, 200);
  }
  w.objects.set("untracked.jpg", "untracked image");
  assert.equal((await w.request("/v1/media/untracked.jpg", { user: "owner" })).status, 404);
});

test("Brand Brain saves and generation queues only assets belonging to the selected client", async (t) => {
  const w = workspace(t);
  assert.equal(
    (
      await w.request("/v1/clients/client-a/brand", {
        user: "owner",
        method: "POST",
        body: { voice: "Warm and direct", audience: "Small businesses" },
      })
    ).status,
    200,
  );
  const brand = await (await w.request("/v1/clients/client-a/brand", { user: "owner" })).json();
  assert.equal(brand.data.voice, "Warm and direct");
  w.exec(
    "INSERT INTO assets(id,client_id,r2_key,filename,content_type) VALUES ('a','client-a','a.jpg','a.jpg','image/jpeg'),('b','client-b','b.jpg','b.jpg','image/jpeg')",
  );
  assert.equal(
    (
      await w.request("/v1/generation-jobs", {
        user: "owner",
        method: "POST",
        body: { clientId: "client-a", assetIds: ["b"] },
      })
    ).status,
    400,
  );
  assert.equal(w.generated.length, 0);
  assert.equal(
    (
      await w.request("/v1/generation-jobs", {
        user: "owner",
        method: "POST",
        body: { clientId: "client-a", assetIds: ["a"] },
      })
    ).status,
    202,
  );
  assert.equal(w.generated.length, 1);
  assert.equal(w.row("SELECT status FROM generation_jobs").status, "queued");
});

async function reviewFixture(t) {
  const w = workspace(t);
  w.post("reviewed");
  w.exec(
    "INSERT INTO review_tokens(id,post_id,token_hash,recipient_email,expires_at,created_at) VALUES (?,?,?,?,?,?)",
    "review",
    "reviewed",
    digest(`${w.env.AUTH_PEPPER}:review:secret`),
    "reviewer@example.test",
    Date.now() + 60000,
    Date.now(),
  );
  return w;
}

test("public review edit, rejection, approval and replay guards preserve workflow states", async (t) => {
  const w = await reviewFixture(t);
  assert.equal(
    (
      await w.request("/v1/public/review/secret/edit", {
        method: "POST",
        body: { caption: "Updated caption" },
      })
    ).status,
    200,
  );
  assert.equal(w.row("SELECT caption FROM posts WHERE id='reviewed'").caption, "Updated caption");
  assert.equal(
    (
      await w.request("/v1/public/review/secret/reject", {
        method: "POST",
        body: { reason: "Change headline" },
      })
    ).status,
    200,
  );
  assert.equal(w.row("SELECT status FROM posts WHERE id='reviewed'").status, "edit_requested");
  await w.request("/v1/public/review/secret/edit", {
    method: "POST",
    body: { headline: "Updated headline" },
  });
  assert.equal(
    (await w.request("/v1/public/review/secret/approve", { method: "POST" })).status,
    409,
  );
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,status) VALUES ('social','client-a','facebook','connected')",
  );
  assert.equal(
    (await w.request("/v1/public/review/secret/approve", { method: "POST" })).status,
    200,
  );
  assert.equal(w.row("SELECT status FROM posts WHERE id='reviewed'").status, "calendar_scheduled");
  assert.equal(
    (await w.request("/v1/public/review/secret/approve", { method: "POST" })).status,
    409,
  );
  assert.equal(
    (
      await w.request("/v1/public/review/secret/edit", {
        method: "POST",
        body: { caption: "Late edit" },
      })
    ).status,
    409,
  );
  w.exec("UPDATE review_tokens SET expires_at=0");
  assert.equal((await w.request("/v1/public/review/secret")).status, 404);
});

test("rescheduling cancels old publish jobs, changes execution version and rejects invalid dates", async (t) => {
  const w = workspace(t);
  w.post("scheduled", "client-a", "calendar_scheduled");
  const old = await ensurePublishJob(w.env, "scheduled");
  assert.equal(
    (
      await w.request("/v1/posts/scheduled/reschedule", {
        user: "owner",
        method: "POST",
        body: { scheduledPublishAt: "invalid" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await w.request("/v1/posts/scheduled/reschedule", {
        user: "owner",
        method: "POST",
        body: { scheduledPublishAt: new Date(Date.now() + 86400000).toISOString() },
      })
    ).status,
    200,
  );
  assert.equal(w.row("SELECT status FROM publish_jobs WHERE id=?", old.jobId).status, "canceled");
  const next = await ensurePublishJob(w.env, "scheduled");
  assert.notEqual(old.executionKey, next.executionKey);
  assert.equal((await claimPublishJob(w.env, old.jobId)).claimed, false);
});

test("publish job duplicates cannot claim twice and retry keeps one execution identity", async (t) => {
  const w = workspace(t);
  w.post("publish", "client-a", "calendar_scheduled");
  const job = await ensurePublishJob(w.env, "publish");
  assert.equal((await ensurePublishJob(w.env, "publish")).jobId, job.jobId);
  const claims = await Promise.all([
    claimPublishJob(w.env, job.jobId),
    claimPublishJob(w.env, job.jobId),
  ]);
  assert.equal(claims.filter((c) => c.claimed).length, 1);
  await markPublishJobRetry(w.env, job.jobId, "Transient error");
  assert.equal((await claimPublishJob(w.env, job.jobId)).attempt, 2);
  await markPublishJobCompleted(w.env, job.jobId);
  assert.equal((await ensurePublishJob(w.env, "publish")).shouldEnqueue, false);
  assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, false);
});

test("calendar respects Indianapolis daylight saving, blackout windows, spacing and daily caps", async (t) => {
  const w = workspace(t);
  w.exec(
    `UPDATE workspace_settings SET preferred_windows='["09:00-11:00"]',blackout_windows='["09:00-09:30"]',min_post_spacing_minutes=60,max_posts_per_day=1`,
  );
  assert.equal(
    await findNextAvailableSlot(w.env, "client-a", "2030-01-07T13:00:00Z"),
    "2030-01-07T14:45:00.000Z",
  );
  assert.equal(
    await findNextAvailableSlot(w.env, "client-a", "2030-07-08T12:00:00Z"),
    "2030-07-08T13:45:00.000Z",
  );
  w.post("existing", "client-a", "calendar_scheduled");
  w.exec("UPDATE posts SET scheduled_publish_at='2030-07-08T13:45:00.000Z' WHERE id='existing'");
  assert.equal(
    await findNextAvailableSlot(w.env, "client-a", "2030-07-08T13:45:00Z"),
    "2030-07-09T13:45:00.000Z",
  );
});

test("Expo receipt failure disables invalid device and preserves successful channel delivery", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO notifications(id,user_id,type,status) VALUES ('notification','owner','publish_success','sent')",
  );
  w.exec(
    "INSERT INTO device_push_tokens(id,user_id,expo_push_token) VALUES ('device','owner','ExponentPushToken[test]')",
  );
  w.exec(`INSERT INTO notification_deliveries(id,notification_id,channel,destination,status,provider_message_id,sent_at)
    VALUES ('push','notification','push','ExponentPushToken[test]','sent','ticket',datetime('now','-20 minutes')),
           ('email','notification','email','owner@example.test','sent','email-ticket',CURRENT_TIMESTAMP)`);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      data: { ticket: { status: "error", details: { error: "DeviceNotRegistered" } } },
    }),
  );
  assert.deepEqual(await checkExpoPushReceipts(w.env), { checked: 1, failed: 1 });
  assert.equal(w.row("SELECT enabled FROM device_push_tokens WHERE id='device'").enabled, 0);
  assert.equal(w.row("SELECT status FROM notifications WHERE id='notification'").status, "partial");
  assert.deepEqual(await checkExpoPushReceipts(w.env), { checked: 0, failed: 0 });
});

test("launch certification persists blockers and warnings; incident dedup handles ISO timestamps", async (t) => {
  const w = workspace(t);
  const user = { id: "owner", role: "owner" };
  const result = await runLaunchCertification(w.env, user);
  assert.equal(result.status, "ready_with_warnings");
  assert.equal(
    w.row("SELECT status FROM launch_certification_runs WHERE id=?", result.id).status,
    result.status,
  );
  delete w.env.OPENAI_API_KEY;
  assert.equal((await runLaunchCertification(w.env, user)).status, "blocked");
  const incident = {
    severity: "error",
    category: "test",
    eventType: "test_failure",
    message: "Test incident",
  };
  await recordSystemEvent(w.env, incident);
  w.exec("UPDATE system_events SET created_at=?", new Date().toISOString());
  await recordSystemEvent(w.env, incident);
  assert.equal(w.row("SELECT COUNT(*) AS count FROM system_events").count, 1);
});

test("analytics isolate clients and include current history across SQLite and ISO timestamps", async (t) => {
  const w = workspace(t);
  w.post("visible", "client-a", "published");
  w.post("hidden", "client-b", "published");
  w.exec(
    "INSERT INTO post_metrics(id,post_id,platform,impressions) VALUES ('visible-metric','visible','facebook',25),('hidden-metric','hidden','facebook',900)",
  );
  w.exec(
    "INSERT INTO analytics_snapshots(id,client_id,impressions) VALUES ('visible-snapshot','client-a',25),('hidden-snapshot','client-b',900)",
  );
  w.exec(
    "UPDATE analytics_snapshots SET captured_at=? WHERE id='hidden-snapshot'",
    new Date().toISOString(),
  );
  const viewer = await (await w.request("/v1/analytics/overview", { user: "viewer" })).json();
  assert.equal(viewer.data.overview.impressions, 25);
  assert.equal(viewer.data.history[0].impressions, 25);
  const owner = await (await w.request("/v1/analytics/overview", { user: "owner" })).json();
  assert.equal(owner.data.overview.impressions, 925);
  assert.equal(owner.data.history[0].impressions, 925);
  assert.equal(
    (await w.request("/v1/analytics/overview?clientId=client-b", { user: "viewer" })).status,
    403,
  );
});

test("publish-now queues one durable execution and requires an assigned destination", async (t) => {
  const w = workspace(t);
  w.post("publish", "client-a", "calendar_scheduled");
  assert.equal(
    (await w.request("/v1/posts/publish/publish-now", { user: "owner", method: "POST" })).status,
    409,
  );
  assert.equal(w.published.length, 0);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,status) VALUES ('social','client-a','facebook','connected')",
  );
  w.exec("UPDATE posts SET social_account_id='social' WHERE id='publish'");
  const response = await w.request("/v1/posts/publish/publish-now", {
    user: "owner",
    method: "POST",
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(w.published[0].publishJobId, payload.publishJobId);
  assert.equal(w.row("SELECT status FROM posts WHERE id='publish'").status, "publish_queued");
  await claimPublishJob(w.env, payload.publishJobId);
  await w.request("/v1/posts/publish/publish-now", { user: "owner", method: "POST" });
  assert.equal(w.published.length, 1);
});

test("bulk actions reject malformed post ID collections without throwing", async (t) => {
  const w = workspace(t);
  for (const action of ["approve", "reject", "shift", "pause"]) {
    for (const postIds of ["invalid", { id: "invalid" }, [null, 4, ""]]) {
      const response = await w.request(`/v1/posts/bulk/${action}`, {
        user: "owner",
        method: "POST",
        body: { postIds, shiftMinutes: 30 },
      });
      assert.equal(response.status, 400);
    }
  }
});

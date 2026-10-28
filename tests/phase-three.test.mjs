import { runAnalyticsJob } from "../cloudflare/src/analytics-jobs.ts";
import { pushNotificationTarget } from "../src/shared/notification-route.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { workspace } from "./workspace.mjs";
import { encryptSecret } from "../cloudflare/src/security.ts";
import { syncAccountAnalytics } from "../cloudflare/src/social.ts";
import worker from "../cloudflare/src/index.ts";
const send = (w, path, body, user = "owner") => w.request(path, { method: "POST", body, user });
const overview = async (w, query = "", user = "owner") =>
  (await (await w.request(`/v1/analytics/overview${query}`, { user })).json()).data;
async function account(
  w,
  id = "social",
  platform = "facebook",
  client = "client-a",
  type = "page",
) {
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,account_type,status,access_token_ciphertext) VALUES(?,?,?,?,'connected',?)",
    id,
    client,
    platform,
    type,
    await encryptSecret("fixture-token", w.env),
  );
}
function metric(w, id, post, value, when = new Date().toISOString()) {
  w.exec(
    "INSERT INTO post_metrics(id,post_id,platform,impressions,measured_at) VALUES(?,?,'facebook',?,?)",
    id,
    post,
    value,
    when,
  );
}
test("same-second measurements select the last inserted sample exactly once in totals, platforms, trends and rankings", async (t) => {
  const w = workspace(t);
  w.post("post", "client-a", "published");
  const capturedAt = new Date().toISOString();
  metric(w, "z-first", "post", 100, capturedAt);
  metric(w, "a-last", "post", 200, capturedAt);
  w.exec("INSERT INTO post_metrics(id,post_id,platform) VALUES('empty-legacy','post','facebook')");
  const data = await overview(w);
  assert.equal(data.overview.impressions, 200);
  assert.equal(data.overview.measured_posts, 1);
  assert.equal(data.byPlatform[0].impressions, 200);
  assert.equal(data.history.at(-1).impressions, 200);
  assert.equal(data.topPosts.length, 1);
  assert.equal(data.topPosts[0].impressions, 200);
});
test("UTC publication cohort is consistent across totals, top posts and trend, including mixed timestamp formats", async (t) => {
  const w = workspace(t);
  for (const id of ["now", "old", "future"]) {
    w.post(id, "client-a", "published");
    metric(w, id, id, 10);
  }
  w.exec("UPDATE posts SET published_at=datetime('now','-8 days') WHERE id='old'");
  w.exec("UPDATE posts SET published_at=datetime('now','+2 days') WHERE id='future'");
  const data = await overview(w, "?days=7");
  assert.equal(data.overview.posts, 1);
  assert.equal(data.overview.impressions, 10);
  assert.deepEqual(
    data.topPosts.map((p) => p.id),
    ["now"],
  );
  assert.equal(data.history.length, 7);
  assert.equal(data.history.at(-1).impressions, 10);
  assert.equal((await overview(w, "?days=30")).overview.posts, 2);
  assert.equal((await w.request("/v1/analytics/overview?days=NaN", { user: "owner" })).status, 400);
});
test("unavailable, partial, measured zero and stale metrics remain distinct", async (t) => {
  const w = workspace(t);
  w.post("p", "client-a", "published");
  let data = await overview(w);
  assert.equal(data.overview.impressions, null);
  assert.equal(data.overview.measurement_status, "unavailable");
  metric(w, "m", "p", 0);
  data = await overview(w);
  assert.equal(data.overview.impressions, 0);
  assert.equal(data.overview.reach, null);
  assert.equal(data.overview.impressions_measured_posts, 1);
  assert.equal(data.overview.reach_measured_posts, 0);
  w.exec("UPDATE post_metrics SET measured_at=datetime('now','-2 days')");
  assert.equal((await overview(w)).overview.measurement_status, "stale");
  w.post("unmeasured", "client-a", "published");
  assert.equal((await overview(w)).overview.measurement_status, "partial");
});
test("provider HTTP failure and malformed success retain last good metrics and report failed sync", async (t) => {
  const w = workspace(t);
  await account(w);
  w.post("p", "client-a", "published");
  w.exec("UPDATE posts SET social_account_id='social',platform_post_id='remote' WHERE id='p'");
  metric(w, "good", "p", 123);
  for (const status of [500, 200]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({}, { status }));
    await assert.rejects(syncAccountAnalytics(w.env, "social"), /Previous measurements retained/);
    assert.equal(w.row("SELECT COUNT(*) AS n FROM post_metrics").n, 1);
    assert.equal((await overview(w)).overview.impressions, 123);
    assert.equal(
      w.row("SELECT status FROM analytics_sync_runs ORDER BY rowid DESC LIMIT 1").status,
      "failed",
    );
    t.mock.restoreAll();
  }
});
test("partial account failures preserve failed posts while retaining successful samples and endpoint surfaces per-account errors", async (t) => {
  const w = workspace(t);
  await account(w, "x", "x");
  for (const id of ["good", "bad"]) {
    w.post(id, "client-a", "published");
    w.exec(
      "UPDATE posts SET social_account_id='x',platform_post_id=?,platform='x' WHERE id=?",
      id,
      id,
    );
    metric(w, `old-${id}`, id, 10);
  }
  t.mock.method(globalThis, "fetch", async (url) =>
    String(url).includes("/good?")
      ? Response.json({ data: { public_metrics: { impression_count: 20, like_count: 0 } } })
      : Response.json({}, { status: 503 }),
  );
  const result = await (await send(w, "/v1/analytics/sync", { accountId: "x" })).json();
  assert.equal(result.results[0].ok, true);
  const jobId = result.results[0].jobId;
  await runAnalyticsJob(w.env, jobId);
  await runAnalyticsJob(w.env, jobId);
  const job = w.row("SELECT * FROM analytics_jobs WHERE id=?", jobId);
  assert.equal(job.status, "partial");
  assert.equal(job.failed, 1);
  assert.match(job.error_message, /1 of 1/);
  assert.equal((await overview(w)).overview.impressions, 30);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM post_metrics WHERE post_id='bad'").n, 1);
});
test("unsupported LinkedIn member analytics are explicit and never manufacture an empty measurement", async (t) => {
  const w = workspace(t);
  await account(w, "member", "linkedin", "client-a", "member");
  w.post("p", "client-a", "published");
  w.exec("UPDATE posts SET social_account_id='member',platform_post_id='remote' WHERE id='p'");
  assert.equal((await syncAccountAnalytics(w.env, "member")).status, "unsupported");
  assert.equal(w.row("SELECT COUNT(*) AS n FROM post_metrics").n, 0);
});
test("analytics refresh visits published posts beyond the former 50-post cutoff", async (t) => {
  const w = workspace(t);
  await account(w, "x", "x");
  for (let i = 0; i < 52; i++) {
    w.post(`p${i}`, "client-a", "published");
    w.exec(
      "UPDATE posts SET social_account_id='x',platform='x',platform_post_id=? WHERE id=?",
      `remote${i}`,
      `p${i}`,
    );
  }
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: { public_metrics: { impression_count: 0 } } }),
  );
  await syncAccountAnalytics(w.env, "x");
  assert.equal(w.row("SELECT COUNT(*) AS n FROM post_metrics").n, 52);
});
test("members can save only their own alert preferences; operational publishing settings remain owner-only", async (t) => {
  const w = workspace(t);
  w.exec("UPDATE workspace_settings SET updated_at='2000-01-01'");
  const before = w.row("SELECT * FROM workspace_settings");
  assert.equal(
    (await send(w, "/v1/settings", { notifications: { emailEnabled: false } }, "viewer")).status,
    200,
  );
  assert.equal(
    w.row("SELECT email_enabled FROM notification_preferences WHERE user_id='viewer'")
      .email_enabled,
    0,
  );
  assert.equal(
    w.row("SELECT COUNT(*) AS n FROM notification_preferences WHERE user_id='owner'").n,
    0,
  );
  assert.deepEqual(w.row("SELECT * FROM workspace_settings"), before);
  for (const body of [
    { workspace: { maxPostsPerDay: 4 } },
    { notifications: { noResponsePolicy: "auto_publish" } },
    { notifications: { prepublishMinutes: 60 } },
  ])
    assert.equal((await send(w, "/v1/settings", body, "viewer")).status, 403);
});
test("legacy owner publishing writes translate into workspace defaults; personal toggles never release holds", async (t) => {
  const w = workspace(t);
  assert.equal(
    (
      await send(w, "/v1/settings", {
        workspace: { defaultNoResponsePolicy: "auto_publish" },
        notifications: { noResponsePolicy: "hold" },
      })
    ).status,
    200,
  );
  assert.equal(
    w.row("SELECT default_no_response_policy AS policy FROM workspace_settings").policy,
    "hold",
  );
  w.exec(
    "UPDATE notification_preferences SET no_response_policy='auto_publish' WHERE user_id='owner'",
  );
  const settings = await (await w.request("/v1/settings", { user: "owner" })).json();
  assert.equal(settings.data.notifications.no_response_policy, "hold");
  await send(w, "/v1/settings", { notifications: { pushEnabled: false } }, "viewer");
  assert.equal(
    w.row("SELECT default_no_response_policy AS policy FROM workspace_settings").policy,
    "hold",
  );
});
test("preference migration preserves an existing active-owner hold", (t) => {
  const w = workspace(t);
  w.exec("INSERT INTO notification_preferences(user_id,no_response_policy) VALUES('owner','hold')");
  w.sqlite.exec("ALTER TABLE workspace_settings DROP COLUMN personal_preferences_version");
  w.sqlite.exec(
    readFileSync(
      new URL("../cloudflare/migrations/0026_personal_preferences.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    w.row("SELECT default_no_response_policy AS policy FROM workspace_settings").policy,
    "hold",
  );
});
test("scheduler uses workspace hold even when an owner personal preference says auto publish", async (t) => {
  const w = workspace(t);
  w.post("p", "client-a", "pre_publish");
  w.exec(
    "UPDATE posts SET scheduled_publish_at=? WHERE id='p'",
    new Date(Date.now() - 60000).toISOString(),
  );
  w.exec("UPDATE workspace_settings SET default_no_response_policy='hold'");
  w.exec(
    "INSERT INTO notification_preferences(user_id,no_response_policy) VALUES('owner','auto_publish')",
  );
  await worker.scheduled({}, w.env);
  assert.equal(w.row("SELECT status FROM posts WHERE id='p'").status, "paused");
  assert.equal(w.published.length, 0);
});
test("notification keyset pages are stable under new inserts, enforce access and count all unread beyond the page", async (t) => {
  const w = workspace(t);
  for (let i = 0; i < 6; i++)
    w.exec(
      "INSERT INTO notifications(id,user_id,type,channel,status,title,created_at) VALUES(?,?,'test','in_app','sent',?,'2026-01-01 12:00:00')",
      `n${i}`,
      "viewer",
      `Message ${i}`,
    );
  w.exec(
    "INSERT INTO notifications(id,user_id,type,channel,status,title) VALUES('hidden','owner','test','in_app','sent','Secret')",
  );
  const get = async (params) =>
    await (await w.request(`/v1/notifications?${params}`, { user: "viewer" })).json();
  const first = await get("limit=2");
  assert.equal(first.unreadCount, 6);
  assert.deepEqual(
    first.data.map((r) => r.id),
    ["n5", "n4"],
  );
  w.exec(
    "INSERT INTO notifications(id,user_id,type,channel,status,title) VALUES('new','viewer','test','in_app','sent','New')",
  );
  const second = await get(`limit=2&cursor=${encodeURIComponent(first.nextCursor)}`);
  assert.deepEqual(
    second.data.map((r) => r.id),
    ["n3", "n2"],
  );
  assert.equal(second.unreadCount, 7);
  const search = await get("search=Message%201");
  assert.deepEqual(
    search.data.map((r) => r.id),
    ["n1"],
  );
  await send(w, "/v1/notifications/n1/read", {}, "viewer");
  assert.equal((await get("filter=unread")).unreadCount, 6);
  assert.equal((await get("search=Secret")).data.length, 0);
});
test("generation keyset history reaches older jobs and applies search/status without exposing other clients", async (t) => {
  const w = workspace(t);
  for (let i = 0; i < 6; i++)
    w.exec(
      "INSERT INTO generation_jobs(id,client_id,asset_ids,status,created_at) VALUES(?,'client-a','[]',?,'2026-01-01 12:00:00')",
      `g${i}`,
      i % 2 ? "failed" : "completed",
    );
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status) VALUES('hidden','client-b','[]','failed')",
  );
  const get = async (params) =>
    await (await w.request(`/v1/generation-jobs?${params}`, { user: "viewer" })).json();
  const first = await get("limit=2");
  assert.deepEqual(
    first.data.map((r) => r.id),
    ["g5", "g4"],
  );
  const next = await get(`limit=2&cursor=${encodeURIComponent(first.nextCursor)}`);
  assert.deepEqual(
    next.data.map((r) => r.id),
    ["g3", "g2"],
  );
  assert.equal((await get("status=failed")).data.length, 3);
  assert.equal((await get("search=missing")).data.length, 0);
  for (const path of [
    "/v1/generation-jobs?limit=NaN",
    "/v1/notifications?cursor=invalid",
    "/v1/notifications?limit=101",
  ])
    assert.equal((await w.request(path, { user: "owner" })).status, 400);
});
test("ownership handover allows promotion and stepping down, and refuses loss of the final active owner", async (t) => {
  const w = workspace(t);
  const role = (id, value) => send(w, `/v1/system/users/${id}/role`, { role: value });
  assert.equal((await role("owner", "admin")).status, 409);
  assert.equal((await role("viewer", "owner")).status, 200);
  assert.equal((await role("owner", "admin")).status, 200);
  assert.equal(w.row("SELECT role FROM users WHERE id='owner'").role, "admin");
  assert.equal((await role("viewer", "admin")).status, 403);
  assert.equal(
    w.row("SELECT COUNT(*) AS n FROM users WHERE role='owner' AND status='active'").n,
    1,
  );
});

test("push taps are user-bound, route only allowlisted destinations and carry the matching inbox ID", () => {
  assert.deepEqual(
    pushNotificationTarget(
      { userId: "u", notificationId: "n", postId: "p", type: "pre_publish" },
      "u",
    ),
    { path: "/posts/p/publish", notificationId: "n" },
  );
  assert.deepEqual(
    pushNotificationTarget({ userId: "u", notificationId: "n", type: "test" }, "u"),
    { path: "/notifications", notificationId: "n" },
  );
  assert.equal(
    pushNotificationTarget({ userId: "other", notificationId: "n", postId: "p" }, "u"),
    null,
  );
  assert.equal(
    pushNotificationTarget({ userId: "u", notificationId: "n", postId: "../settings" }, "u"),
    null,
  );
  assert.deepEqual(
    pushNotificationTarget(
      { userId: "u", notificationId: "n", deepLink: "https://evil.test/phish" },
      "u",
    ),
    { path: "/notifications", notificationId: "n" },
  );
  assert.deepEqual(
    pushNotificationTarget({ userId: "u", notificationId: "n", deepLink: "/calendar" }, "u"),
    { path: "/calendar", notificationId: "n" },
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import { encryptSecret } from "../cloudflare/src/security.ts";
import { enqueueAnalytics, runAnalyticsJob } from "../cloudflare/src/analytics-jobs.ts";
import { analyticsRange, fetchAccountInsights } from "../cloudflare/src/platform-analytics.ts";
async function account(
  w,
  id = "account",
  client = "client-a",
  platform = "facebook",
  type = "page",
) {
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,account_type,account_name,external_account_id,status,access_token_ciphertext) VALUES(?,?,?,?,?,?,'connected',?)",
    id,
    client,
    platform,
    type,
    `Connected ${id}`,
    `remote-${id}`,
    await encryptSecret("fixture-secret", w.env),
  );
}
const get = async (w, query = "", user = "owner") =>
  (await (await w.request(`/v1/analytics/overview${query}`, { user })).json()).data;
const sync = async (w, body = { accountId: "account", days: 30 }, user = "owner") => {
  const response = await w.request("/v1/analytics/sync", { user, method: "POST", body });
  return { status: response.status, body: await response.json() };
};
async function drain(w, id) {
  for (let i = 0; i < 60; i++) {
    await runAnalyticsJob(w.env, id);
    if (
      !["queued", "running"].includes(
        w.row("SELECT status FROM analytics_jobs WHERE id=?", id).status,
      )
    )
      return;
  }
  throw Error("Job failed to terminate");
}
function facebook(t, w, { pages = false } = {}) {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    seen.push({ url, init });
    assert.equal(url.hostname, "graph.facebook.com");
    assert.equal(url.searchParams.has("access_token"), false);
    if (url.searchParams.has("fields") && !url.pathname.endsWith("/posts"))
      return Response.json({ followers_count: 77 });
    if (url.pathname.endsWith("/insights")) {
      const metric = url.searchParams.get("metric");
      return Response.json({
        data: metric.split(",").map((name) => ({
          name,
          values: [
            {
              value:
                name.includes("media_view") && !name.includes("unique")
                  ? 120
                  : name.includes("engagements")
                    ? 7
                    : 23,
              end_time: analyticsRange(30).end.toISOString(),
            },
          ],
        })),
      });
    }
    if (url.pathname.endsWith("/posts"))
      return Response.json({
        data: [
          {
            id: url.searchParams.has("after") ? "external-2" : "external-1",
            message: "Created outside BrandSparQ",
            created_time: new Date().toISOString(),
            permalink_url: "https://www.facebook.com/post",
            reactions: { summary: { total_count: 8 } },
            comments: { summary: { total_count: 2 } },
          },
        ],
        ...(pages && !url.searchParams.has("after")
          ? {
              paging: {
                next: "https://evil.invalid/steal?access_token=private",
                cursors: { after: "next-safe-cursor" },
              },
            }
          : {}),
      });
    throw Error(`Unexpected fixture path ${url.pathname}`);
  });
  return seen;
}
test("default platform sync fetches account insights and external content with zero app posts", async (t) => {
  const w = workspace(t);
  await account(w);
  const seen = facebook(t, w, { pages: true });
  const result = await sync(w);
  assert.equal(result.status, 202);
  const id = result.body.results[0].jobId;
  assert.equal(seen.length, 0);
  assert.equal(w.row("SELECT COUNT(*) n FROM analytics_job_items").n, 0);
  await drain(w, id);
  assert.equal(w.row("SELECT status FROM analytics_jobs WHERE id=?", id).status, "completed");
  assert.equal(w.row("SELECT COUNT(*) n FROM platform_content").n, 2);
  assert.equal(w.row("SELECT COUNT(*) n FROM posts").n, 0);
  assert.equal(w.row("SELECT COUNT(*) n FROM publish_jobs").n, 0);
  const data = await get(w);
  assert.equal(data.scope, "platform");
  assert.equal(data.accounts[0].error, null);
  assert.equal(data.overview.views, 120);
  assert.equal(data.overview.followers, 77);
  assert.equal(data.overview.reach, null);
  assert.equal(data.overview.posts, 2);
  assert.equal(data.topPosts[0].from_app, false);
  assert.equal(data.history.at(-1).reach, 23);
  assert.equal(
    seen.filter((row) => row.url.searchParams.get("after") === "next-safe-cursor").length,
    1,
  );
});
test("resync upserts content and identifies app-originated posts without counting duplicates", async (t) => {
  const w = workspace(t);
  await account(w);
  facebook(t, w);
  w.post("local", "client-a", "published");
  w.exec(
    "UPDATE posts SET social_account_id='account',platform_post_id='external-1' WHERE id='local'",
  );
  await drain(w, (await sync(w)).body.results[0].jobId);
  await drain(w, (await sync(w)).body.results[0].jobId);
  const data = await get(w);
  assert.equal(data.overview.posts, 1);
  assert.equal(data.topPosts[0].from_app, true);
  assert.equal(w.row("SELECT COUNT(*) n FROM platform_content").n, 1);
  assert.equal(w.row("SELECT COUNT(*) n FROM posts").n, 1);
});
test("missing permissions are actionable, preserve last complete values and never finish as empty success", async (t) => {
  const w = workspace(t);
  await account(w);
  facebook(t, w);
  await drain(w, (await sync(w)).body.results[0].jobId);
  const previous = w.row("SELECT * FROM platform_account_insights");
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: { code: 200, message: "secret-token private account details" } },
      { status: 403 },
    ),
  );
  const result = await sync(w);
  await drain(w, result.body.results[0].jobId);
  const job = w.row("SELECT * FROM analytics_jobs WHERE id=?", result.body.results[0].jobId);
  assert.equal(job.status, "partial");
  assert.match(job.error_message, /Permission required/);
  assert.doesNotMatch(job.error_message, /secret-token|private account/);
  assert.deepEqual(w.row("SELECT * FROM platform_account_insights"), previous);
  const data = await get(w);
  assert.equal(data.accounts[0].measurement_status, "needs_attention");
  assert.equal(data.overview.views, 120);
  assert.match(data.accounts[0].error, /Permission required/);
});
test("first sync with insufficient permissions reports unavailable instead of manufacturing zero", async (t) => {
  const w = workspace(t);
  await account(w);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { code: 10 } }, { status: 403 }),
  );
  await drain(w, (await sync(w)).body.results[0].jobId);
  const data = await get(w);
  assert.equal(data.overview.views, null);
  assert.equal(data.accounts[0].measured_at, null);
  assert.equal(data.accounts[0].measurement_status, "needs_attention");
});
test("account and content metrics are private to assigned clients, including explicit account filters", async (t) => {
  const w = workspace(t);
  await account(w, "account", "client-a");
  await account(w, "hidden", "client-b");
  facebook(t, w);
  await drain(w, (await sync(w)).body.results[0].jobId);
  await drain(w, (await sync(w, { accountId: "hidden", days: 30 })).body.results[0].jobId);
  assert.equal((await get(w, "", "owner")).accounts.length, 2);
  assert.equal((await get(w, "", "viewer")).accounts.length, 1);
  assert.equal((await get(w, "?accountId=hidden", "viewer")).accounts.length, 0);
  assert.equal(
    (await w.request("/v1/analytics/overview?clientId=client-b", { user: "viewer" })).status,
    403,
  );
  assert.equal((await sync(w, { accountId: "hidden", days: 30 }, "viewer")).status, 403);
});
test("duplicate delivery and replacement claims cannot commit old platform results", async (t) => {
  const w = workspace(t);
  await account(w);
  const job = await enqueueAnalytics(w.env, "account", 30, "platform");
  let replaced = false;
  const mock = facebook(t, w);
  const handler = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (...args) => {
    if (!replaced) {
      replaced = true;
      w.exec(
        "UPDATE analytics_jobs SET claim_token='new-worker',claim_until=? WHERE id=?",
        Date.now() + 300000,
        job.id,
      );
    }
    return handler(...args);
  });
  await runAnalyticsJob(w.env, job.id);
  assert.equal(w.row("SELECT claim_token FROM analytics_jobs").claim_token, "new-worker");
  assert.equal(w.row("SELECT COUNT(*) n FROM platform_account_insights").n, 0);
  await runAnalyticsJob(w.env, job.id);
  assert.equal(w.row("SELECT COUNT(*) n FROM platform_account_insights").n, 0);
});
test("reconnecting during pagination cannot import the previous connection's content", async (t) => {
  const w = workspace(t);
  await account(w);
  facebook(t, w);
  const id = (await sync(w)).body.results[0].jobId;
  await runAnalyticsJob(w.env, id);
  w.exec(
    "UPDATE social_accounts SET connection_revision=connection_revision+1,external_account_id='replacement' WHERE id='account'",
  );
  await runAnalyticsJob(w.env, id);
  assert.equal(w.row("SELECT status FROM analytics_jobs").status, "partial");
  assert.equal(w.row("SELECT COUNT(*) n FROM platform_content").n, 0);
  assert.equal((await get(w)).overview.views, null);
});
test("Instagram range totals use bounded intervals and never add interval reach", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (!url.pathname.endsWith("/insights")) return Response.json({ followers_count: 12 });
    const name = url.searchParams.get("metric");
    if (url.searchParams.get("metric_type") === "time_series")
      return Response.json({
        data: [
          {
            name,
            values: [
              {
                value: 2,
                end_time: new Date(
                  Number(url.searchParams.get("since")) * 1000 + 86400000,
                ).toISOString(),
              },
            ],
          },
        ],
      });
    return Response.json({ data: [{ name, total_value: { value: name === "reach" ? 8 : 10 } }] });
  });
  const summary = await fetchAccountInsights(
    { platform: "instagram", external_account_id: "ig-id" },
    "fixture",
    90,
  );
  assert.equal(summary.metrics.views, 30);
  assert.equal(summary.metrics.reach, null);
  assert.equal(summary.daily.length, 3);
  assert.ok(
    calls
      .filter((url) => url.searchParams.has("since"))
      .every(
        (url) =>
          Number(url.searchParams.get("until")) - Number(url.searchParams.get("since")) <=
          30 * 86400,
      ),
  );
});
test("a missing Instagram interval never becomes a misleading partial total", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/insights")) return Response.json({ followers_count: 12 });
    const name = url.searchParams.get("metric");
    if (url.searchParams.get("metric_type") === "time_series")
      return Response.json({ data: [{ name, values: [] }] });
    if (name === "views" && ++count === 2)
      return Response.json({ data: [{ name, total_value: {} }] });
    return Response.json({ data: [{ name, total_value: { value: 10 } }] });
  });
  const summary = await fetchAccountInsights(
    { platform: "instagram", external_account_id: "ig" },
    "fixture",
    90,
  );
  assert.equal(summary.metrics.views, null);
  assert.ok(summary.warnings.some((row) => row.startsWith("Error: views")));
});
test("TikTok platform ingestion uses public video pagination and keeps views separate from reach", async (t) => {
  const w = workspace(t);
  await account(w, "account", "client-a", "tiktok", "user");
  let pages = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes("user/info"))
      return Response.json({ data: { user: { follower_count: 20 } }, error: { code: "ok" } });
    assert.equal(init.method, "POST");
    assert.equal(JSON.parse(init.body).max_count, 20);
    pages++;
    return Response.json({
      data: {
        videos: [
          {
            id: `v-${pages}`,
            title: "Native TikTok video",
            create_time: Math.floor(Date.now() / 1000),
            view_count: 100,
            like_count: 4,
          },
        ],
        has_more: pages === 1,
        cursor: pages === 1 ? Date.now() - 1000 : 0,
      },
      error: { code: "ok" },
    });
  });
  await drain(w, (await sync(w)).body.results[0].jobId);
  const data = await get(w);
  assert.equal(data.overview.followers, 20);
  assert.equal(data.overview.views, null);
  assert.equal(data.topPosts[0].views, 100);
  assert.equal(data.overview.reach, null);
  assert.equal(data.topPosts.length, 2);
});
test("X imports recent timeline posts rather than querying only locally stored IDs", async (t) => {
  const w = workspace(t);
  await account(w, "account", "client-a", "x", "user");
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/tweets")) {
      assert.ok(Date.parse(url.searchParams.get("end_time")) <= Date.now());
      return Response.json({
        data: [
          {
            id: "tweet-external",
            text: "Outside app",
            created_at: new Date().toISOString(),
            public_metrics: { like_count: 5, impression_count: 30 },
          },
        ],
      });
    }
    return Response.json({ data: { public_metrics: { followers_count: 15 } } });
  });
  await drain(w, (await sync(w)).body.results[0].jobId);
  const data = await get(w);
  assert.equal(data.topPosts[0].id, "tweet-external");
  assert.equal(data.overview.followers, 15);
  assert.equal(data.overview.views, null);
});
test("unsupported LinkedIn member accounts explain eligibility instead of fake completion", async (t) => {
  const w = workspace(t);
  await account(w, "account", "client-a", "linkedin", "member");
  await drain(w, (await sync(w)).body.results[0].jobId);
  const data = await get(w);
  assert.equal(data.accounts[0].measurement_status, "needs_attention");
  assert.match(data.accounts[0].error, /organization Page/);
  assert.equal(data.overview.views, null);
});
test("platform jobs coalesce only matching scope and range and reject unsupported ranges", async (t) => {
  const w = workspace(t);
  await account(w);
  const a = await enqueueAnalytics(w.env, "account", 30, "platform");
  const b = await enqueueAnalytics(w.env, "account", 30, "platform");
  assert.equal(a.id, b.id);
  await assert.rejects(enqueueAnalytics(w.env, "account", 7, "platform"), /already running/);
  await assert.rejects(enqueueAnalytics(w.env, "account", 30, "brandsparq"), /already running/);
  await assert.rejects(enqueueAnalytics(w.env, "account", 365, "platform"), /7, 30 or 90/);
});

test("completed content discovery removes deleted posts but a failed refresh does not", async (t) => {
  const w = workspace(t);
  await account(w);
  facebook(t, w);
  await drain(w, (await sync(w)).body.results[0].jobId);
  assert.equal(w.row("SELECT COUNT(*) n FROM platform_content").n, 1);
  t.mock.restoreAll();
  const original = facebook(t, w);
  const handler = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, init) =>
    new URL(String(input)).pathname.endsWith("/posts")
      ? Response.json({ data: [] })
      : handler(input, init),
  );
  await drain(w, (await sync(w)).body.results[0].jobId);
  assert.equal(w.row("SELECT COUNT(*) n FROM platform_content").n, 0);
});
test("permission failures on content insights retain its last complete measurement", async (t) => {
  const w = workspace(t);
  await account(w);
  facebook(t, w);
  await drain(w, (await sync(w)).body.results[0].jobId);
  const old = w.row("SELECT metrics_json,measured_at FROM platform_content");
  t.mock.restoreAll();
  facebook(t, w);
  const handler = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, init) =>
    new URL(String(input)).pathname.includes("external-1/insights")
      ? Response.json({ error: { code: 200 } }, { status: 403 })
      : handler(input, init),
  );
  await drain(w, (await sync(w)).body.results[0].jobId);
  assert.equal(
    w.row("SELECT status FROM analytics_jobs ORDER BY rowid DESC LIMIT 1").status,
    "partial",
  );
  assert.deepEqual(w.row("SELECT metrics_json,measured_at FROM platform_content"), old);
});
test("a previous reporting period remains visible per account but is excluded from current period totals", async (t) => {
  const w = workspace(t);
  await account(w);
  facebook(t, w);
  await drain(w, (await sync(w)).body.results[0].jobId);
  w.exec(
    "UPDATE platform_account_insights SET range_start=datetime(range_start,'-1 day'),range_end=datetime(range_end,'-1 day')",
  );
  const data = await get(w);
  assert.equal(data.accounts[0].metrics.views, 120);
  assert.equal(data.overview.views, null);
  assert.equal(data.accounts[0].measurement_status, "stale");
});
test("LinkedIn organization account insights are independent of app-created posts", async (t) => {
  const w = workspace(t);
  await account(w, "account", "client-a", "linkedin", "organization");
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("organizationalEntityShareStatistics"))
      return Response.json({
        elements: [
          {
            timeRange: { start: Date.now() },
            totalShareStatistics: { impressionCount: 90, likeCount: 6 },
          },
        ],
      });
    return Response.json({
      elements: [
        {
          id: "urn:li:share:external",
          commentary: "Outside app",
          createdAt: Date.now(),
          lifecycleState: "PUBLISHED",
        },
      ],
      paging: { links: [] },
    });
  });
  await drain(w, (await sync(w)).body.results[0].jobId);
  const data = await get(w);
  assert.equal(data.overview.impressions, 90);
  assert.equal(data.topPosts[0].id, "urn:li:share:external");
  assert.equal(w.row("SELECT COUNT(*) n FROM posts").n, 0);
});

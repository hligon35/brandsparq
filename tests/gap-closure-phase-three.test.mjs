import test from "node:test";
import assert from "node:assert/strict";
import { encode } from "fast-png";
import { encode as jpeg } from "jpeg-js";
import { workspace } from "./workspace.mjs";
import worker from "../cloudflare/src/index.ts";
import { inspectImage, readUpload } from "../cloudflare/src/upload-validation.ts";
import { resolveApiOrigin } from "../src/shared/api-origin.ts";
import {
  enqueueAnalytics,
  runAnalyticsJob,
  recoverAnalyticsJobs,
} from "../cloudflare/src/analytics-jobs.ts";
import { calendarDate, calendarDayStart } from "../src/shared/calendar-time.ts";
const png = () =>
  encode({
    width: 2,
    height: 1,
    data: new Uint8Array([20, 40, 60, 255, 40, 60, 80, 255]),
    channels: 4,
  });
const send = (w, path, body = {}, user = "owner") =>
  w.request(path, { user, method: "POST", body });
function upload(w, bytes = png(), path = "/v1/assets", type = "image/png") {
  return worker.fetch(
    new Request(w.env.PUBLIC_BASE_URL + path, {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        "x-client-id": "client-a",
        "content-type": type,
        "x-image-width": "999999",
      },
      body: bytes,
    }),
    w.env,
  );
}
test("images require complete decoding and authoritative dimensions; corrupt and mismatched derivatives fail", async (t) => {
  const w = workspace(t),
    result = await upload(w);
  assert.equal(result.status, 201);
  const id = (await result.json()).data.id;
  assert.equal(w.row("SELECT width FROM assets WHERE id=?", id).width, 2);
  assert.equal((await upload(w, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).status, 415);
  assert.equal(
    (await upload(w, "not an image", `/v1/assets/${id}/derivative`, "image/jpeg")).status,
    415,
  );
  assert.equal((await upload(w, png(), `/v1/assets/${id}/derivative`, "image/jpeg")).status, 415);
  const bytes = jpeg({ width: 1, height: 1, data: new Uint8Array([20, 40, 60, 255]) }, 80).data;
  assert.equal((await upload(w, bytes, `/v1/assets/${id}/derivative`, "image/jpeg")).status, 200);
  assert.throws(() => inspectImage(bytes.slice(0, -8).buffer), /Unsupported|malformed/);
});
test("reupload repairs missing and corrupt originals without changing asset identity", async (t) => {
  const w = workspace(t);
  const first = (await (await upload(w)).json()).data;
  const key = w.row("SELECT r2_key FROM assets WHERE id=?", first.id).r2_key;
  for (const missing of [true, false]) {
    if (missing) w.objects.delete(key);
    else w.objects.set(key, "corrupt");
    const second = await upload(w);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).data.id, first.id);
    assert.deepEqual(new Uint8Array(w.objects.get(key)), png());
  }
  assert.equal(w.row("SELECT COUNT(*) n FROM assets").n, 1);
});
test("concurrent identical uploads create one asset and failed R2 writes have a working retry", async (t) => {
  const w = workspace(t),
    put = w.env.MEDIA.put;
  let fails = true;
  w.env.MEDIA.put = async (...args) => {
    if (fails) throw Error("R2 down");
    return put(...args);
  };
  assert.equal((await upload(w)).status, 500);
  assert.equal(w.row("SELECT COUNT(*) n FROM assets").n, 1);
  fails = false;
  const results = await Promise.all([upload(w), upload(w)]);
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(w.row("SELECT COUNT(*) n FROM assets").n, 1);
});
test("D1 rejection creates no orphan object", async (t) => {
  const w = workspace(t);
  w.exec(
    "CREATE TRIGGER reject_asset BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT,'DB down'); END",
  );
  assert.equal((await upload(w)).status, 500);
  assert.equal(w.objects.size, 0);
});
test("streaming upload limit cancels before buffering an oversized body", async () => {
  let canceled = false;
  const stream = new ReadableStream({
    pull(c) {
      c.enqueue(new Uint8Array(20));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(
    readUpload(new Request("https://test", { method: "POST", body: stream, duplex: "half" }), 10),
    /size limit/,
  );
  assert.equal(canceled, true);
});
test("retired generation API cannot create unready or duplicate work", async (t) => {
  const w = workspace(t);
  for (let i = 0; i < 2; i++) {
    const r = await send(w, "/v1/generation-jobs", { clientId: "client-a", assetIds: ["missing"] });
    assert.equal(r.status, 410);
    assert.equal((await r.json()).replacement, "/v1/creation-jobs");
  }
  assert.equal(w.generated.length, 0);
});
test("paused recovery reaches and restores records beyond page one, with search and authorization", async (t) => {
  const w = workspace(t);
  for (let i = 0; i < 121; i++) {
    w.post(`p${String(i).padStart(3, "0")}`, "client-a", "paused");
    w.exec("UPDATE posts SET graphic_key='image' WHERE id=?", `p${String(i).padStart(3, "0")}`);
  }
  w.post("private", "client-b", "paused");
  let cursor,
    ids = [];
  do {
    const page = await (
      await w.request(
        `/v1/posts/paused?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { user: "viewer" },
      )
    ).json();
    ids.push(...page.data.map((p) => p.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(ids).size, 121);
  assert.ok(!ids.includes("private"));
  assert.equal((await send(w, `/v1/posts/${ids.at(-1)}/restore-review`)).status, 200);
  const found = await (
    await w.request("/v1/posts/paused?search=Client%20B", { user: "viewer" })
  ).json();
  assert.equal(found.data.length, 0);
  assert.equal((await w.request("/v1/posts/paused?cursor=bad", { user: "owner" })).status, 400);
});
test("API origins are deterministic across web, development, release, staging and fixture builds", () => {
  const base = { platform: "ios", development: false };
  assert.equal(resolveApiOrigin(base), "https://brandsparq.getsparqd.com");
  assert.equal(resolveApiOrigin({ ...base, platform: "web" }), "");
  assert.throws(
    () => resolveApiOrigin({ ...base, configured: "http://localhost:8787" }),
    /Release/,
  );
  assert.equal(
    resolveApiOrigin({ ...base, development: true, configured: "http://192.168.1.2:8787" }),
    "http://192.168.1.2:8787",
  );
  assert.throws(() => resolveApiOrigin({ ...base, environment: "staging" }), /required/);
  assert.throws(
    () =>
      resolveApiOrigin({
        ...base,
        environment: "staging",
        configured: "https://brandsparq.getsparqd.com",
      }),
    /isolated/,
  );
  assert.equal(
    resolveApiOrigin({
      ...base,
      environment: "staging",
      configured: "https://brandsparq-staging.example.workers.dev",
    }),
    "https://brandsparq-staging.example.workers.dev",
  );
  assert.equal(
    resolveApiOrigin({ ...base, fixture: true, configured: "http://127.0.0.1:8788" }),
    "http://127.0.0.1:8788",
  );
  assert.throws(
    () =>
      resolveApiOrigin({ ...base, fixture: true, configured: "https://brandsparq.getsparqd.com" }),
    /loopback/,
  );
});
function account(w, id = "account", client = "client-a") {
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,account_type) VALUES(?,?,'linkedin',?,'connected','member')",
    id,
    client,
    id,
  );
}
test("manual analytics enqueues immediately, coalesces concurrent callers and recovers queue-send failure", async (t) => {
  const w = workspace(t);
  account(w);
  w.env.GENERATION_QUEUE.send = async () => {
    throw Error("queue down");
  };
  const results = await Promise.all([
    enqueueAnalytics(w.env, "account"),
    enqueueAnalytics(w.env, "account"),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(w.row("SELECT COUNT(*) n FROM analytics_jobs").n, 1);
  const queued = [];
  w.env.GENERATION_QUEUE.send = async (b) => queued.push(b);
  await recoverAnalyticsJobs(w.env);
  assert.equal(queued[0].jobId, results[0].id);
  await runAnalyticsJob(w.env, results[0].id);
  assert.equal(w.row("SELECT status FROM analytics_jobs").status, "partial");
});
test("analytics duplicate delivery and an expired claim cannot overwrite a newer worker", async (t) => {
  const w = workspace(t);
  account(w);
  const job = await enqueueAnalytics(w.env, "account");
  w.exec(
    "UPDATE analytics_jobs SET status='running',claim_token='live',claim_until=? WHERE id=?",
    Date.now() + 10000,
    job.id,
  );
  await runAnalyticsJob(w.env, job.id);
  assert.equal(w.row("SELECT claim_token FROM analytics_jobs").claim_token, "live");
  w.exec("UPDATE analytics_jobs SET claim_until=0 WHERE id=?", job.id);
  await runAnalyticsJob(w.env, job.id);
  const before = w.row("SELECT failed FROM analytics_jobs").failed;
  await runAnalyticsJob(w.env, job.id);
  assert.equal(w.row("SELECT failed FROM analytics_jobs").failed, before);
});
test("analytics progress is scoped to accessible clients", async (t) => {
  const w = workspace(t);
  account(w);
  account(w, "secret", "client-b");
  await enqueueAnalytics(w.env, "account");
  await enqueueAnalytics(w.env, "secret");
  const rows = (await (await w.request("/v1/analytics/jobs", { user: "viewer" })).json()).data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].client_id, "client-a");
});
test("dashboard boundaries use workspace timezone and actual DST day length", async (t) => {
  const w = workspace(t);
  w.exec("UPDATE workspace_settings SET timezone='America/New_York'");
  const result = await (await w.request("/v1/dashboard", { user: "owner" })).json();
  assert.equal(result.data.day.timezone, "America/New_York");
  for (const [instant, hours] of [
    ["2026-03-08T12:00:00Z", 23],
    ["2026-11-01T12:00:00Z", 25],
  ]) {
    const day = calendarDate(new Date(instant), "America/New_York");
    assert.equal(
      (calendarDayStart(new Date(day.getTime() + 86400000), "America/New_York") -
        calendarDayStart(day, "America/New_York")) /
        3600000,
      hours,
    );
  }
});
test("malformed JSON and wrong field types return JSON without modifying saved state", async (t) => {
  const w = workspace(t);
  assert.equal((await send(w, "/v1/clients", { name: { bad: true } })).status, 400);
  assert.equal((await send(w, "/v1/clients", null)).status, 400);
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 2);
  const r = await worker.fetch(
    new Request(w.env.PUBLIC_BASE_URL + "/v1/clients", {
      method: "POST",
      headers: { authorization: "Bearer owner-token", "content-type": "application/json" },
      body: "{",
    }),
    w.env,
  );
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /JSON/);
});
test("generation resource budget is enforced atomically without consuming another request identity", async (t) => {
  const w = workspace(t);
  for (let i = 0; i < 10; i++)
    w.exec(
      "INSERT INTO generation_jobs(id,client_id,requested_by,request_key,asset_ids,status) VALUES(?,'client-a','owner',?,'[]','queued')",
      `j${i}`,
      `key${i}`,
    );
  assert.throws(
    () =>
      w.exec(
        "INSERT INTO generation_jobs(id,client_id,requested_by,request_key,asset_ids,status) VALUES('over','client-a','owner','over','[]','queued')",
      ),
    /BUDGET/,
  );
  assert.equal(w.row("SELECT COUNT(*) n FROM generation_jobs").n, 10);
});
test("generation refresh removes changed-filter jobs while keeping older loaded pages", async () => {
  const { refreshPages } = await import("../src/shared/refresh-pages.ts");
  const calls = [];
  const old = [{ id: "completed-now" }, { id: "older-still-failed" }];
  const result = await refreshPages(
    { data: [{ id: "new-failure" }], nextCursor: "page-two" },
    old.length,
    async (cursor) => {
      calls.push(cursor);
      return { data: [old[1]], nextCursor: "page-three" };
    },
    1,
  );
  assert.deepEqual(
    result.data.map((x) => x.id),
    ["new-failure", "older-still-failed"],
  );
  assert.deepEqual(calls, ["page-two"]);
  assert.equal(result.nextCursor, "page-three");
});
test("analytics accepts durable progress before provider calls and processes one snapshot item per delivery", async (t) => {
  const w = workspace(t);
  account(w);
  for (const id of ["a", "b"]) {
    w.post(id, "client-a", "published");
    w.exec("UPDATE posts SET social_account_id='account',platform_post_id=? WHERE id=?", id, id);
  }
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("No provider needed for unsupported member");
  });
  const response = await send(w, "/v1/analytics/sync", { accountId: "account", days: 7 });
  assert.equal(response.status, 202);
  const result = await response.json(),
    id = result.results[0].jobId;
  assert.equal(calls, 0);
  await runAnalyticsJob(w.env, id);
  let row = w.row("SELECT * FROM analytics_jobs WHERE id=?", id);
  assert.equal(row.status, "queued");
  assert.equal(row.processed, 1);
  await runAnalyticsJob(w.env, id);
  row = w.row("SELECT * FROM analytics_jobs WHERE id=?", id);
  assert.equal(row.status, "partial");
  assert.equal(row.processed, 2);
  assert.equal(row.range_days, 7);
});
test("signed webhook bytes survive the common JSON validator unchanged", async () => {
  const { validatedRequest } = await import("../cloudflare/src/request-validation.ts");
  const body = '{ "object" : "page" }';
  const request = new Request("https://test/v1/social/webhooks/meta", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(await (await validatedRequest(request)).text(), body);
});
test("an old analytics worker cannot commit progress over a replacement claim", async (t) => {
  const w = workspace(t);
  account(w);
  w.post("p", "client-a", "published");
  w.exec("UPDATE posts SET social_account_id='account',platform_post_id='p' WHERE id='p'");
  const job = await enqueueAnalytics(w.env, "account");
  const batch = w.env.DB.batch;
  let replace = true;
  w.env.DB.batch = async (statements) => {
    if (replace) {
      replace = false;
      w.exec(
        "UPDATE analytics_jobs SET claim_token='replacement',claim_until=? WHERE id=?",
        Date.now() + 10000,
        job.id,
      );
    }
    return batch(statements);
  };
  await runAnalyticsJob(w.env, job.id);
  assert.equal(w.row("SELECT processed FROM analytics_jobs").processed, 0);
  assert.equal(w.row("SELECT status FROM analytics_job_items").status, "queued");
  w.exec("UPDATE analytics_jobs SET claim_until=0 WHERE id=?", job.id);
  await runAnalyticsJob(w.env, job.id);
  assert.equal(w.row("SELECT processed FROM analytics_jobs").processed, 1);
});
test("recent unsupported analytics accounts do not starve a never-synced account beyond the cron batch", async (t) => {
  const w = workspace(t);
  for (let i = 0; i < 21; i++) {
    account(w, `account${i}`);
    w.exec(
      "UPDATE social_accounts SET health_checked_at=? WHERE id=?",
      new Date().toISOString(),
      `account${i}`,
    );
    if (i < 20)
      w.exec(
        "INSERT INTO analytics_jobs(id,social_account_id,status) VALUES(?,?,'partial')",
        `old${i}`,
        `account${i}`,
      );
  }
  await worker.scheduled({}, w.env);
  assert.equal(
    w.row("SELECT COUNT(*) n FROM analytics_jobs WHERE social_account_id='account20'").n,
    1,
  );
});
test("provider bodies are rejected before oversized response buffering", async (t) => {
  const { providerFetch } = await import("../cloudflare/src/provider-http.ts");
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("small", { headers: { "content-length": String(33 * 1024 * 1024) } }),
  );
  await assert.rejects(providerFetch("https://provider.test"), /32 MB/);
});

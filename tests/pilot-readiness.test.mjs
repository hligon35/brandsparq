import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/src/index.ts";
import { workspace } from "./workspace.mjs";
import {
  claimPublishJob,
  ensurePublishJob,
  stopScheduledPost,
} from "../cloudflare/src/publishing.ts";
import { recoverStaleWork, runLaunchCertification } from "../cloudflare/src/operations.ts";
import { findNextAvailableSlot, validateSchedule } from "../cloudflare/src/scheduling.ts";
import { runRevisionJob, recoverRevisionJobs } from "../cloudflare/src/generation.ts";

test("both logo pointers reject assets owned by another client without changing Brand Brain", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO assets(id,client_id,r2_key,filename,content_type) VALUES ('foreign','client-b','logo','logo.png','image/png')",
  );
  for (const field of ["logoAssetId", "alternateLogoAssetId"]) {
    const result = await w.request("/v1/clients/client-a/brand", {
      user: "owner",
      method: "POST",
      body: { voice: "Changed", [field]: "foreign", expectedRevision: 0 },
    });
    assert.equal(result.status, 400);
    assert.equal(w.row("SELECT COUNT(*) AS n FROM brand_profiles WHERE client_id='client-a'").n, 0);
  }
});

test("pause wins before claim; a publisher that already claimed prevents pause", async (t) => {
  const w = workspace(t);
  w.post("first", "client-a", "calendar_scheduled");
  const first = await ensurePublishJob(w.env, "first");
  assert.equal(await stopScheduledPost(w.env, "first", "paused"), true);
  assert.equal((await claimPublishJob(w.env, first.jobId)).claimed, false);
  assert.equal(w.row("SELECT status FROM publish_jobs WHERE id=?", first.jobId).status, "canceled");
  w.post("second", "client-a", "calendar_scheduled");
  const second = await ensurePublishJob(w.env, "second");
  assert.equal((await claimPublishJob(w.env, second.jobId)).claimed, true);
  assert.equal(await stopScheduledPost(w.env, "second", "paused"), false);
  const response = await w.request("/v1/posts/bulk/pause", {
    user: "owner",
    method: "POST",
    body: { postIds: ["second"] },
  });
  assert.equal((await response.json()).results[0].ok, false);
});

test("scheduler selection cannot resurrect a concurrently paused post", async (t) => {
  const w = workspace(t);
  w.post("race", "client-a", "calendar_scheduled");
  w.exec("UPDATE posts SET scheduled_publish_at='2000-01-01T00:00:00.000Z' WHERE id='race'");
  const original = w.env.DB.prepare;
  let intercepted = false;
  w.env.DB.prepare = (sql) => {
    const statement = original(sql);
    if (sql.includes("SELECT p.id, p.client_id, p.platform, p.scheduled_publish_at")) {
      const all = statement.all;
      statement.all = async () => {
        const rows = await all.call(statement);
        intercepted = true;
        await stopScheduledPost(w.env, "race", "paused");
        return rows;
      };
    }
    return statement;
  };
  await worker.scheduled({}, w.env);
  assert.equal(intercepted, true);
  assert.equal(w.row("SELECT status FROM posts WHERE id='race'").status, "paused");
  assert.equal(w.published.length, 0);
});

test("stale publishing is held for provider reconciliation while unsent outbox work recovers", async (t) => {
  const w = workspace(t);
  w.post("stale", "client-a", "calendar_scheduled");
  const job = await ensurePublishJob(w.env, "stale");
  await claimPublishJob(w.env, job.jobId);
  w.exec("UPDATE posts SET status='publishing' WHERE id='stale'");
  w.exec("UPDATE publish_jobs SET claimed_at='2000-01-01',updated_at='2000-01-01'");
  await recoverStaleWork(w.env);
  assert.equal(
    w.row("SELECT failure_code FROM posts WHERE id='stale'").failure_code,
    "PUBLISH_OUTCOME_UNKNOWN",
  );
  assert.equal(w.published.length, 0);
  w.post("unsent", "client-a", "calendar_scheduled");
  const unsent = await ensurePublishJob(w.env, "unsent");
  w.exec("UPDATE publish_jobs SET updated_at='2000-01-01' WHERE id=?", unsent.jobId);
  await recoverStaleWork(w.env);
  assert.equal(w.published.length, 1);
});

test("past dates move to a future valid slot and report a scheduling conflict", async (t) => {
  const w = workspace(t);
  const start = Date.now();
  const next = await findNextAvailableSlot(w.env, "client-a", "2000-01-01T10:00:00Z");
  assert.ok(Date.parse(next) > start);
  assert.equal((await validateSchedule(w.env, "client-a", "2000-01-01T10:00:00Z")).conflict, true);
});

test("revision outbox survives a queue send failure and duplicate deliveries execute AI once", async (t) => {
  const w = workspace(t);
  w.post("edit");
  w.env.GENERATION_QUEUE.send = async () => {
    throw Error("queue unavailable");
  };
  const result = await w.request("/v1/posts/edit/ai-rewrite-caption", {
    user: "owner",
    method: "POST",
    body: { instruction: "Be brief" },
  });
  assert.equal(result.status, 200);
  assert.equal(w.row("SELECT status FROM revision_jobs").status, "queued");
  w.env.GENERATION_QUEUE.send = async (body) => w.generated.push(body);
  await recoverRevisionJobs(w.env);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({
      output_text: JSON.stringify({ headline: "New", caption: "New caption", hashtags: [] }),
    });
  });
  await Promise.all([
    runRevisionJob(w.env, w.generated[0].revisionJobId),
    runRevisionJob(w.env, w.generated[0].revisionJobId),
  ]);
  assert.equal(calls, 1);
  assert.equal(w.row("SELECT status FROM revision_jobs").status, "completed");
  assert.equal(w.row("SELECT status FROM posts WHERE id='edit'").status, "awaiting_approval");
});

test("certification blocks schema drift before dependent queries and validates staging origin", async (t) => {
  const w = workspace(t);
  w.env.ENVIRONMENT = "staging";
  w.env.PUBLIC_BASE_URL = "https://brandsparq-staging.fixture.workers.dev";
  w.env.GOOGLE_REDIRECT_URI = w.env.PUBLIC_BASE_URL + "/v1/auth/google/callback";
  const ready = await runLaunchCertification(w.env, { id: "owner", role: "owner" });
  assert.equal(ready.blockers.length, 0);
  w.exec("DROP INDEX idx_revision_jobs_active");
  w.exec("ALTER TABLE posts RENAME COLUMN revision_job_id TO missing_revision_id");
  const result = await runLaunchCertification(w.env, { id: "owner", role: "owner" });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some((x) => x.includes("revision_job_id")));
  assert.ok(result.blockers.some((x) => x.includes("idx_revision_jobs_active")));
});

test("a recovered job cannot publish a future schedule unless an explicit publish-now decision exists", async (t) => {
  const w = workspace(t);
  w.post("future", "client-a", "calendar_scheduled");
  w.exec(
    "UPDATE posts SET scheduled_publish_at=? WHERE id='future'",
    new Date(Date.now() + 86400000).toISOString(),
  );
  const job = await ensurePublishJob(w.env, "future");
  assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, false);
  w.exec("UPDATE posts SET prepublish_response='publish_now' WHERE id='future'");
  assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, true);
});

test("stale outbox recovery cannot overwrite a publisher that claimed after selection", async (t) => {
  const w = workspace(t);
  w.post("race", "client-a", "calendar_scheduled");
  const job = await ensurePublishJob(w.env, "race");
  w.exec("UPDATE publish_jobs SET status='retrying',updated_at='2000-01-01' WHERE id=?", job.jobId);
  const original = w.env.DB.prepare;
  w.env.DB.prepare = (sql) => {
    const statement = original(sql);
    if (sql.includes("SELECT id,post_id,execution_key,attempt_count,max_attempts,last_error")) {
      const all = statement.all;
      statement.all = async () => {
        const rows = await all.call(statement);
        assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, true);
        return rows;
      };
    }
    return statement;
  };
  await recoverStaleWork(w.env);
  assert.equal(w.row("SELECT status FROM publish_jobs WHERE id=?", job.jobId).status, "publishing");
  assert.equal(w.published.length, 0);
});

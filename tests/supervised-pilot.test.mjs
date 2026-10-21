import { readFileSync } from "node:fs";
import { configurePilot } from "../cloudflare/src/pilot.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import worker from "../cloudflare/src/index.ts";
import { PILOT_EVIDENCE } from "../src/shared/pilot.ts";
import { ensurePublishJob, claimPublishJob } from "../cloudflare/src/publishing.ts";

function destination(w, id = "accepted", client = "client-a") {
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,account_name,status) VALUES (?,?,'facebook',?,'Test page','connected')",
    id,
    client,
    id,
  );
}
function accepted(revision = 0) {
  return {
    mode: "supervised",
    expectedRevision: revision,
    endsAt: new Date(Date.now() + 86400000).toISOString(),
    releaseCommit: "a".repeat(40),
    destinations: [{ clientId: "client-a", socialAccountId: "accepted" }],
    evidence: Object.fromEntries(
      PILOT_EVIDENCE.map((item) => [item.id, `https://evidence.example/${item.id}`]),
    ),
  };
}
async function activate(w, overrides = {}) {
  return w.request("/v1/system/pilot", {
    user: "owner",
    method: "POST",
    body: { ...accepted(), ...overrides },
  });
}
async function job(w, id, client = "client-a", account = "accepted", supervisor = "owner") {
  w.post(id, client, "calendar_scheduled");
  w.exec(
    "UPDATE posts SET social_account_id=?,prepublish_response='publish_now' WHERE id=?",
    account,
    id,
  );
  return ensurePublishJob(w.env, id, null, supervisor);
}

test("pilot controls require owner authentication and preserve normal deployments by default", async (t) => {
  const w = workspace(t);
  assert.equal((await w.request("/v1/system/pilot")).status, 401);
  assert.equal((await w.request("/v1/system/pilot", { user: "viewer" })).status, 403);
  assert.equal(
    (
      await w.request("/v1/system/pilot", {
        user: "viewer",
        method: "POST",
        body: { mode: "hold", expectedRevision: 0 },
      })
    ).status,
    403,
  );
  const data = (await (await w.request("/v1/system/pilot", { user: "owner" })).json()).data;
  assert.equal(data.mode, "normal");
  assert.equal(data.revision, 0);
});

test("hold cancels unclaimed jobs and pauses scheduled posts while preserving a claimed publisher", async (t) => {
  const w = workspace(t);
  destination(w);
  const pending = await job(w, "pending");
  const running = await job(w, "running");
  assert.equal((await claimPublishJob(w.env, running.jobId)).claimed, true);
  const result = await w.request("/v1/system/pilot", {
    user: "owner",
    method: "POST",
    body: { mode: "hold", expectedRevision: 0 },
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).data.inFlight, 1);
  assert.equal(w.row("SELECT status FROM posts WHERE id='pending'").status, "paused");
  assert.equal(
    w.row("SELECT status FROM publish_jobs WHERE id=?", pending.jobId).status,
    "canceled",
  );
  assert.equal(
    w.row("SELECT status FROM publish_jobs WHERE id=?", running.jobId).status,
    "publishing",
  );
  assert.equal(
    w.row("SELECT COUNT(*) AS n FROM recovery_actions WHERE action='configure_pilot'").n,
    1,
  );
  assert.equal(
    (
      await w.request("/v1/system/pilot", {
        user: "owner",
        method: "POST",
        body: { mode: "hold", expectedRevision: 0 },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await w.request("/v1/team/invitations", {
        user: "owner",
        method: "POST",
        body: { email: "new@example.test", role: "viewer", clientRoles: { "client-a": "viewer" } },
      })
    ).status,
    409,
  );
});

test("supervised activation requires all acceptance references, bounded dates and client-owned connected destinations", async (t) => {
  const w = workspace(t);
  destination(w);
  for (const change of [
    { evidence: {} },
    { evidence: { ...accepted().evidence, ci: "https://evidence.example/report?token=secret" } },
    { endsAt: new Date(Date.now() - 1000).toISOString() },
    { endsAt: new Date(Date.now() + 8 * 86400000).toISOString() },
    { releaseCommit: "not-a-commit" },
    { destinations: [{ clientId: "client-b", socialAccountId: "accepted" }] },
    {
      destinations: [
        { clientId: "client-a", socialAccountId: "accepted" },
        { clientId: "client-a", socialAccountId: "accepted" },
      ],
    },
  ])
    assert.equal((await activate(w, change)).status, 400);
  assert.equal((await activate(w)).status, 200);
  assert.equal((await activate(w, { expectedRevision: 1, mode: "normal" })).status, 400);
});

test("pilot publishes require an active owner decision and an accepted destination at claim time", async (t) => {
  const w = workspace(t);
  destination(w);
  destination(w, "outside", "client-b");
  assert.equal((await activate(w)).status, 200);
  const acceptedJob = await job(w, "accepted-post");
  w.exec("UPDATE users SET role='publisher' WHERE id='viewer'");
  const nonOwner = await job(w, "non-owner", "client-a", "accepted", "viewer");
  const outside = await job(w, "outside-post", "client-b", "outside");
  assert.equal((await claimPublishJob(w.env, nonOwner.jobId)).claimed, false);
  assert.equal((await claimPublishJob(w.env, outside.jobId)).claimed, false);
  w.exec("UPDATE users SET status='suspended' WHERE id='owner'");
  assert.equal((await claimPublishJob(w.env, acceptedJob.jobId)).claimed, false);
  w.exec("UPDATE users SET status='active' WHERE id='owner'");
  assert.equal((await claimPublishJob(w.env, acceptedJob.jobId)).claimed, true);
});

test("concurrent pilot claims enforce one execution per client UTC day, even if the first job later fails", async (t) => {
  const w = workspace(t);
  destination(w);
  assert.equal((await activate(w)).status, 200);
  const a = await job(w, "a");
  const b = await job(w, "b");
  const results = await Promise.all([
    claimPublishJob(w.env, a.jobId),
    claimPublishJob(w.env, b.jobId),
  ]);
  assert.equal(results.filter((r) => r.claimed).length, 1);
  w.exec("UPDATE publish_jobs SET status='failed' WHERE status='publishing'");
  const denied = results[0].claimed ? b : a;
  assert.equal((await claimPublishJob(w.env, denied.jobId)).claimed, false);
  assert.match(
    (await (await w.request("/v1/posts/b/publish-now", { user: "owner", method: "POST" })).json())
      .error,
    /limit/,
  );
});

test("an expired pilot fails closed and queue bypasses become paused without provider calls", async (t) => {
  const w = workspace(t);
  destination(w);
  assert.equal((await activate(w)).status, 200);
  const pending = await job(w, "pending");
  w.exec("UPDATE pilot_settings SET ends_at='2000-01-01T00:00:00.000Z'");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("Provider must not run");
  });
  await worker.queue(
    {
      messages: [
        {
          body: {
            kind: "publish",
            publishJobId: pending.jobId,
            postId: "pending",
            executionKey: pending.executionKey,
          },
          ack() {},
          retry() {
            throw Error("No retry expected");
          },
        },
      ],
    },
    w.env,
  );
  assert.equal(calls, 0);
  assert.equal(w.row("SELECT status FROM posts WHERE id='pending'").status, "paused");
  assert.equal(
    w.row("SELECT status FROM publish_jobs WHERE id=?", pending.jobId).status,
    "canceled",
  );
  assert.equal(
    (await w.request("/v1/posts/pending/publish-now", { user: "owner", method: "POST" })).status,
    409,
  );
});

test("pilot configuration changes fence previous owner decisions and invitation scope", async (t) => {
  const w = workspace(t);
  destination(w);
  assert.equal((await activate(w)).status, 200);
  const previous = await job(w, "previous");
  assert.equal((await activate(w, { expectedRevision: 1 })).status, 200);
  assert.equal((await claimPublishJob(w.env, previous.jobId)).claimed, false);
  assert.equal(
    (
      await w.request("/v1/team/invitations", {
        user: "owner",
        method: "POST",
        body: {
          email: "outside@example.test",
          role: "viewer",
          clientRoles: { "client-b": "viewer" },
        },
      })
    ).status,
    409,
  );
});

test("scheduler holds pilot posts despite an auto-publish workspace policy", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "fixture-delivery" }));
  const w = workspace(t);
  destination(w);
  assert.equal((await activate(w)).status, 200);
  w.post("due", "client-a", "calendar_scheduled");
  w.exec(
    "UPDATE posts SET scheduled_publish_at='2000-01-01T00:00:00.000Z',social_account_id='accepted' WHERE id='due'",
  );
  w.exec("UPDATE workspace_settings SET default_no_response_policy='auto_publish'");
  await worker.scheduled({}, w.env);
  assert.equal(w.row("SELECT status FROM posts WHERE id='due'").status, "paused");
  assert.equal(w.published.length, 0);
});

test("competing pilot updates by the same owner cannot apply the losing scope or audit", async (t) => {
  const w = workspace(t);
  destination(w);
  destination(w, "other", "client-b");
  const inputs = [
    accepted(),
    { ...accepted(), destinations: [{ clientId: "client-b", socialAccountId: "other" }] },
  ];
  const results = await Promise.all(
    inputs.map((input) => configurePilot(w.env, { id: "owner", role: "owner" }, input)),
  );
  assert.equal(results.filter((r) => r.body.ok).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 1);
  const winner = results.findIndex((r) => r.body.ok);
  assert.equal(
    w.row("SELECT client_id FROM pilot_destinations").client_id,
    inputs[winner].destinations[0].clientId,
  );
  assert.equal(
    w.row("SELECT COUNT(*) AS n FROM recovery_actions WHERE action='configure_pilot'").n,
    1,
  );
});

test("an owner decision for an older pilot revision cannot acquire a current-revision claim", async (t) => {
  const w = workspace(t);
  destination(w);
  assert.equal((await activate(w)).status, 200);
  w.post("old-decision", "client-a", "calendar_scheduled");
  w.exec(
    "UPDATE posts SET social_account_id='accepted',prepublish_response='publish_now' WHERE id='old-decision'",
  );
  const job = await ensurePublishJob(w.env, "old-decision", null, "owner", 0);
  assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, false);
});

test("staging initialization holds its own queue without changing another workspace", async (t) => {
  const staging = workspace(t);
  const production = workspace(t);
  destination(staging);
  destination(production);
  const stageJob = await job(staging, "stage");
  const prodJob = await job(production, "prod");
  staging.sqlite.exec(
    readFileSync(new URL("../cloudflare/staging-init.sql", import.meta.url), "utf8"),
  );
  assert.equal((await claimPublishJob(staging.env, stageJob.jobId)).claimed, false);
  assert.equal((await claimPublishJob(production.env, prodJob.jobId)).claimed, true);
});

test("a blocked old queue execution cannot pause or cancel a newer supervised execution", async (t) => {
  const w = workspace(t);
  destination(w);
  assert.equal((await activate(w)).status, 200);
  const old = await job(w, "post");
  w.exec(
    "UPDATE posts SET publish_version=publish_version+1,status='publish_queued' WHERE id='post'",
  );
  const current = await ensurePublishJob(w.env, "post", null, "owner");
  await worker.queue(
    {
      messages: [
        {
          body: {
            kind: "publish",
            publishJobId: old.jobId,
            postId: "post",
            executionKey: old.executionKey,
          },
          ack() {},
          retry() {
            throw Error("No retry expected");
          },
        },
      ],
    },
    w.env,
  );
  assert.equal(w.row("SELECT status FROM posts WHERE id='post'").status, "publish_queued");
  assert.equal(w.row("SELECT status FROM publish_jobs WHERE id=?", current.jobId).status, "queued");
  assert.equal((await claimPublishJob(w.env, current.jobId)).claimed, true);
});

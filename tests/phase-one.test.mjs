import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import { ensurePublishJob, claimPublishJob } from "../cloudflare/src/publishing.ts";
import { recoverStaleWork } from "../cloudflare/src/operations.ts";
import { dispatchGeneration } from "../cloudflare/src/generation-dispatch.ts";
import { encryptSecret } from "../cloudflare/src/security.ts";
import worker from "../cloudflare/src/index.ts";
import {
  runGenerationJob,
  runGraphicJob,
  finalizeGenerationReview,
} from "../cloudflare/src/generation.ts";

const send = (w, path, body, user = "owner") => w.request(path, { user, method: "POST", body });
// Intercept after the read, before the mutation, preserving its stale snapshot.
function afterRead(w, match, method, callback) {
  const prepare = w.env.DB.prepare;
  w.env.DB.prepare = (sql) => {
    const wrap = (statement) => {
      const bind = statement.bind;
      statement.bind = (...args) => wrap(bind(...args));
      if (match(sql)) {
        const read = statement[method];
        statement[method] = async (...args) => callback(await read.apply(statement, args));
      }
      return statement;
    };
    return wrap(prepare(sql));
  };
}
function scheduled(w, id = "post", status = "calendar_scheduled") {
  w.post(id, "client-a", status);
  w.exec(
    "UPDATE posts SET approved_at=CURRENT_TIMESTAMP,scheduled_publish_at='2030-01-07T15:00:00Z' WHERE id=?",
    id,
  );
}
function unknown(w, id = "post") {
  scheduled(w, id, "failed");
  w.exec("UPDATE posts SET failure_code='PUBLISH_OUTCOME_UNKNOWN' WHERE id=?", id);
}
const proof = {
  outcome: "published",
  publishVersion: 1,
  providerPostId: "provider-existing",
  evidence: "Checked the correct provider account and verified its post URL at 10:00.",
};

for (const winner of ["published", "publishing", "version"]) {
  test(`keep schedule loses to ${winner} after reading the post`, async (t) => {
    const w = workspace(t);
    scheduled(w);
    const job = await ensurePublishJob(w.env, "post");
    let once = false;
    afterRead(
      w,
      (sql) => sql === "SELECT client_id, status, publish_version FROM posts WHERE id = ?",
      "first",
      async (row) => {
        if (!once) {
          once = true;
          if (winner === "published")
            w.exec(
              "UPDATE posts SET status='published',platform_post_id='existing' WHERE id='post'",
            );
          if (winner === "publishing") {
            w.exec("UPDATE posts SET prepublish_response='publish_now' WHERE id='post'");
            assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, true);
          }
          if (winner === "version")
            w.exec("UPDATE posts SET publish_version=publish_version+1 WHERE id='post'");
        }
        return row;
      },
    );
    assert.equal((await send(w, "/v1/posts/post/keep-schedule")).status, 409);
    assert.equal(
      w.row("SELECT COUNT(*) AS n FROM audit_logs WHERE action='post.keep_schedule'").n,
      0,
    );
    if (winner === "published")
      assert.equal(w.row("SELECT status FROM posts WHERE id='post'").status, "published");
    if (winner === "publishing")
      assert.equal(
        w.row("SELECT status FROM publish_jobs WHERE id=?", job.jobId).status,
        "publishing",
      );
  });
}

test("keep schedule accepts an approved scheduled post and rejects paused or incomplete posts", async (t) => {
  const w = workspace(t);
  scheduled(w);
  assert.equal((await send(w, "/v1/posts/post/keep-schedule")).status, 200);
  scheduled(w, "paused", "paused");
  assert.equal((await send(w, "/v1/posts/paused/keep-schedule")).status, 409);
  w.exec("UPDATE posts SET approved_at=NULL WHERE id='post'");
  assert.equal((await send(w, "/v1/posts/post/keep-schedule")).status, 409);
});

for (const cap of [1, 3])
  test(`concurrent paused resumes reserve distinct slots and honor daily cap ${cap}`, async (t) => {
    const w = workspace(t);
    scheduled(w, "a", "paused");
    scheduled(w, "b", "paused");
    w.exec(
      "UPDATE workspace_settings SET preferred_windows='[]',max_posts_per_day=?,min_post_spacing_minutes=180",
      cap,
    );
    let release;
    const both = new Promise((resolve) => {
      release = resolve;
    });
    let reads = 0;
    afterRead(
      w,
      (sql) => sql.includes("SELECT id, scheduled_publish_at FROM posts"),
      "all",
      async (rows) => {
        if (++reads <= 2) {
          if (reads === 2) release();
          await both;
        }
        return rows;
      },
    );
    const responses = await Promise.all([
      send(w, "/v1/posts/a/resume"),
      send(w, "/v1/posts/b/resume"),
    ]);
    assert.deepEqual(
      responses.map((r) => r.status),
      [200, 200],
    );
    const a = w.row("SELECT scheduled_publish_at FROM posts WHERE id='a'").scheduled_publish_at;
    const b = w.row("SELECT scheduled_publish_at FROM posts WHERE id='b'").scheduled_publish_at;
    assert.ok(Math.abs(Date.parse(a) - Date.parse(b)) >= 180 * 60000);
    if (cap === 1) {
      const day = (value) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Indiana/Indianapolis" }).format(
          new Date(value),
        );
      assert.notEqual(day(a), day(b));
    }
    assert.equal(
      w.row("SELECT schedule_revision FROM clients WHERE id='client-a'").schedule_revision,
      2,
    );
  });

for (const action of ["resume", "cancel", "restore-review"])
  test(`stale paused ${action} cannot overwrite a newer transition`, async (t) => {
    const w = workspace(t);
    scheduled(w, "post", "paused");
    if (action === "restore-review")
      w.exec("UPDATE posts SET approved_at=NULL,graphic_key='image.jpg' WHERE id='post'");
    let once = false;
    afterRead(
      w,
      (sql) => sql === "SELECT * FROM posts WHERE id=?",
      "first",
      (row) => {
        if (!once) {
          once = true;
          w.exec("UPDATE posts SET publish_version=publish_version+1 WHERE id='post'");
        }
        return row;
      },
    );
    assert.equal((await send(w, `/v1/posts/post/${action}`)).status, 409);
    assert.equal(w.row("SELECT status FROM posts WHERE id='post'").status, "paused");
  });

const badSettings = [
  { timezone: "Not/A_Zone" },
  { timezone: null },
  { minPostSpacingMinutes: -10 },
  { minPostSpacingMinutes: 0 },
  { minPostSpacingMinutes: 1.5 },
  { maxPostsPerDay: 0 },
  { maxPostsPerDay: "3" },
  { defaultPrepublishMinutes: -1 },
  { analyticsRefreshHours: 0 },
  { defaultNoResponsePolicy: "publish_whatever" },
  { preferredWindows: ["bad-window"] },
  { blackoutWindows: ["24:00-25:00"] },
  { preferredWindows: ["12:00-12:00"] },
  { preferredWindows: "09:00-10:00" },
];
test("invalid workspace settings are rejected atomically, including the reproduced mixed payload", async (t) => {
  const w = workspace(t),
    before = w.row("SELECT * FROM workspace_settings");
  for (const fields of [
    ...badSettings,
    {
      timezone: "Not/A_Zone",
      minPostSpacingMinutes: -10,
      maxPostsPerDay: 0,
      preferredWindows: ["bad-window"],
    },
  ]) {
    assert.equal(
      (await send(w, "/v1/settings", { workspace: fields, notifications: { emailEnabled: false } }))
        .status,
      400,
      JSON.stringify(fields),
    );
    assert.deepEqual(w.row("SELECT * FROM workspace_settings"), before);
    assert.equal(w.row("SELECT COUNT(*) AS n FROM notification_preferences").n, 0);
  }
  for (const notifications of [
    { noResponsePolicy: "invalid" },
    { prepublishMinutes: 0 },
    { emailEnabled: "false" },
  ])
    assert.equal(
      (await send(w, "/v1/settings", { workspace: { maxPostsPerDay: 4 }, notifications })).status,
      400,
    );
  assert.equal(
    (
      await send(w, "/v1/settings", {
        workspace: {
          timezone: "UTC",
          minPostSpacingMinutes: 60,
          maxPostsPerDay: 4,
          preferredWindows: ["22:00-02:00"],
          blackoutWindows: [],
        },
        notifications: { noResponsePolicy: "hold" },
      })
    ).status,
    200,
  );
});

test("client creation and editing reject invalid time zones before writing any client data", async (t) => {
  const w = workspace(t);
  assert.equal(
    (await send(w, "/v1/clients", { name: "New", timezone: "Invalid/Zone" })).status,
    400,
  );
  assert.equal(
    (await send(w, "/v1/clients/client-a", { name: "Changed", timezone: "Invalid/Zone" })).status,
    400,
  );
  assert.equal(w.row("SELECT name FROM clients WHERE id='client-a'").name, "Client A");
  assert.equal(w.row("SELECT COUNT(*) AS n FROM clients").n, 2);
});

function source(w) {
  w.exec(
    "INSERT INTO assets(id,client_id,r2_key,filename,content_type) VALUES('asset','client-a','a.jpg','a.jpg','image/jpeg')",
  );
}
const creation = {
  clientId: "client-a",
  assetIds: ["asset"],
  objective: "Auto",
  requestKey: "stable_generation_request_1",
};

test("initial queue send failure is a visible failed job; retry and ambiguous creation reuse one identity", async (t) => {
  const w = workspace(t);
  source(w);
  const sendQueue = w.env.GENERATION_QUEUE.send;
  w.env.GENERATION_QUEUE.send = async () => {
    throw Error("Fixture queue unavailable");
  };
  const response = await send(w, "/v1/generation-jobs", creation);
  assert.equal(response.status, 202);
  const job = await response.json();
  assert.equal(job.status, "failed");
  assert.match(job.error, /enqueue/);
  assert.equal((await (await send(w, "/v1/generation-jobs", creation)).json()).jobId, job.jobId);
  assert.equal(
    (await send(w, "/v1/generation-jobs", { ...creation, objective: "Promote" })).status,
    409,
  );
  w.env.GENERATION_QUEUE.send = sendQueue;
  assert.equal((await send(w, `/v1/generation-jobs/${job.jobId}/retry`)).status, 200);
  assert.equal(w.generated[0].jobId, job.jobId);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM generation_jobs").n, 1);
});

test("concurrent creation retries enqueue only one durable generation job", async (t) => {
  const w = workspace(t);
  source(w);
  const responses = await Promise.all([
    send(w, "/v1/generation-jobs", creation),
    send(w, "/v1/generation-jobs", creation),
  ]);
  const jobs = await Promise.all(responses.map((r) => r.json()));
  assert.equal(jobs[0].jobId, jobs[1].jobId);
  assert.equal(w.generated.length, 1);
});

test("a send that throws after worker claim does not mark the active job failed", async (t) => {
  const w = workspace(t);
  source(w);
  w.env.GENERATION_QUEUE.send = async ({ jobId }) => {
    w.exec("UPDATE generation_jobs SET status='processing',claim_token='worker' WHERE id=?", jobId);
    throw Error("Lost queue response");
  };
  const job = await (await send(w, "/v1/generation-jobs", creation)).json();
  assert.equal(job.status, "processing");
});

test("a late failed dispatch cannot fail a newer retry of the same job", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status,control_token) VALUES('job','client-a','[]','queued','old')",
  );
  w.env.GENERATION_QUEUE.send = async () => {
    w.exec("UPDATE generation_jobs SET control_token='new' WHERE id='job'");
    throw Error("Old dispatch failed");
  };
  await dispatchGeneration(w.env, "job");
  assert.equal(w.row("SELECT status FROM generation_jobs").status, "queued");
});

test("stale generation recovery cannot overwrite completion after its read", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status,stage_updated_at) VALUES('job','client-a','[]','processing','2000-01-01')",
  );
  afterRead(
    w,
    (sql) => sql.includes("SELECT id,status,stage,stage_updated_at"),
    "all",
    (rows) => {
      w.exec("UPDATE generation_jobs SET status='completed' WHERE id='job'");
      return rows;
    },
  );
  await recoverStaleWork(w.env);
  assert.equal(w.row("SELECT status FROM generation_jobs").status, "completed");
  assert.equal(w.generated.length, 0);
});

for (const outcome of ["published", "absent"])
  test(`owner records ${outcome} with atomic evidence and no automatic republish`, async (t) => {
    const w = workspace(t);
    unknown(w);
    const job = await ensurePublishJob(w.env, "post");
    w.exec("UPDATE publish_jobs SET status='failed' WHERE id=?", job.jobId);
    assert.equal((await send(w, "/v1/system/posts/post/retry")).status, 409);
    assert.equal(
      (await send(w, "/v1/system/posts/post/reconcile", { ...proof, outcome }, "viewer")).status,
      403,
    );
    assert.equal(
      (await send(w, "/v1/system/posts/post/reconcile", { ...proof, outcome, evidence: "" }))
        .status,
      400,
    );
    const responses = await Promise.all([
      send(w, "/v1/system/posts/post/reconcile", { ...proof, outcome }),
      send(w, "/v1/system/posts/post/reconcile", { ...proof, outcome }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      w.row("SELECT COUNT(*) AS n FROM recovery_actions WHERE action='reconcile_publish_outcome'")
        .n,
      1,
    );
    assert.equal(
      JSON.parse(
        w.row("SELECT metadata_json FROM recovery_actions WHERE action='reconcile_publish_outcome'")
          .metadata_json,
      ).evidence,
      proof.evidence,
    );
    assert.equal(w.published.length, 0);
    const post = w.row("SELECT * FROM posts WHERE id='post'");
    assert.equal(post.publish_version, 2);
    if (outcome === "published") {
      assert.equal(post.status, "published");
      assert.equal(post.platform_post_id, proof.providerPostId);
      assert.equal((await send(w, "/v1/system/posts/post/retry")).status, 409);
    } else {
      assert.equal(post.failure_code, "PUBLISH_CONFIRMED_ABSENT");
      assert.equal((await send(w, "/v1/system/posts/post/retry")).status, 200);
      assert.equal(w.published.length, 1);
    }
    assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, false);
  });

test("reconciliation refuses stale versions, active publishers, and an already assigned provider ID", async (t) => {
  const w = workspace(t);
  unknown(w);
  assert.equal(
    (await send(w, "/v1/system/posts/post/reconcile", { ...proof, publishVersion: 9 })).status,
    409,
  );
  const job = await ensurePublishJob(w.env, "post");
  w.exec("UPDATE publish_jobs SET status='publishing' WHERE id=?", job.jobId);
  assert.equal((await send(w, "/v1/system/posts/post/reconcile", proof)).status, 409);
  w.exec("UPDATE publish_jobs SET status='failed'");
  scheduled(w, "other", "published");
  w.exec("UPDATE posts SET platform_post_id=? WHERE id='other'", proof.providerPostId);
  assert.equal((await send(w, "/v1/system/posts/post/reconcile", proof)).status, 409);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM recovery_actions").n, 0);
});

test("a failed-post retry cannot regress a post published after the initial read", async (t) => {
  const w = workspace(t);
  scheduled(w, "post", "failed");
  afterRead(
    w,
    (sql) => sql.includes("SELECT id,status,scheduled_publish_at,publish_version,failure_code"),
    "first",
    (row) => {
      w.exec("UPDATE posts SET status='published',platform_post_id='existing' WHERE id='post'");
      return row;
    },
  );
  assert.equal((await send(w, "/v1/system/posts/post/retry")).status, 409);
  assert.equal(w.published.length, 0);
});

test("Publish Now loses to a new version without enqueueing or reporting success", async (t) => {
  const w = workspace(t);
  scheduled(w);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status) VALUES('social','client-a','facebook','page','connected')",
  );
  w.exec("UPDATE posts SET social_account_id='social' WHERE id='post'");
  afterRead(
    w,
    (sql) =>
      sql.includes(
        "SELECT id, client_id, social_account_id, scheduled_publish_at, status, publish_version",
      ),
    "first",
    (row) => {
      w.exec("UPDATE posts SET publish_version=publish_version+1 WHERE id='post'");
      return row;
    },
  );
  assert.equal((await send(w, "/v1/posts/post/publish-now")).status, 409);
  assert.equal(w.published.length, 0);
});

test("late provider completion after owner reconciliation preserves the decision and raises an incident", async (t) => {
  const w = workspace(t);
  scheduled(w);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,access_token_ciphertext) VALUES('social','client-a','facebook','page','connected',?)",
    await encryptSecret("fixture", w.env),
  );
  w.exec(
    "UPDATE posts SET social_account_id='social',graphic_key='image.jpg',prepublish_response='publish_now' WHERE id='post'",
  );
  w.objects.set("image.jpg", "fixture");
  const job = await ensurePublishJob(w.env, "post");
  t.mock.method(globalThis, "fetch", async () => {
    w.exec(
      "UPDATE posts SET status='failed',failure_code='PUBLISH_OUTCOME_UNKNOWN' WHERE id='post'",
    );
    w.exec("UPDATE publish_jobs SET status='failed' WHERE id=?", job.jobId);
    assert.equal(
      (await send(w, "/v1/system/posts/post/reconcile", { ...proof, outcome: "absent" })).status,
      200,
    );
    return Response.json({ id: "photo", post_id: "late-provider-id" });
  });
  await worker.queue(
    {
      messages: [
        {
          body: {
            kind: "publish",
            publishJobId: job.jobId,
            postId: "post",
            executionKey: job.executionKey,
          },
          attempts: 1,
          ack() {},
          retry() {
            throw Error("No automatic retry");
          },
        },
      ],
    },
    w.env,
  );
  assert.equal(
    w.row("SELECT failure_code FROM posts WHERE id='post'").failure_code,
    "PUBLISH_CONFIRMED_ABSENT",
  );
  assert.equal(
    w.row("SELECT provider_post_id FROM social_publish_receipts").provider_post_id,
    "late-provider-id",
  );
  assert.equal(
    w.row("SELECT severity FROM system_events WHERE event_type='late_publish_result'").severity,
    "critical",
  );
});

test("editing workspace rules preserves omitted preferences and advances calendar reservations", async (t) => {
  const w = workspace(t);
  assert.equal(
    (
      await send(w, "/v1/settings", {
        notifications: { emailEnabled: false, pushEnabled: false, noResponsePolicy: "hold" },
      })
    ).status,
    200,
  );
  assert.equal((await send(w, "/v1/settings", { workspace: { maxPostsPerDay: 5 } })).status, 200);
  const prefs = w.row("SELECT * FROM notification_preferences WHERE user_id='owner'");
  assert.equal(prefs.email_enabled, 0);
  assert.equal(prefs.push_enabled, 0);
  assert.equal(prefs.no_response_policy, "hold");
  assert.equal(
    w.row("SELECT schedule_revision FROM clients WHERE id='client-a'").schedule_revision,
    2,
  );
});

test("a rule change between slot selection and reservation forces a fresh daily-cap selection", async (t) => {
  const w = workspace(t);
  scheduled(w, "a", "paused");
  scheduled(w, "existing");
  w.exec(
    "UPDATE workspace_settings SET preferred_windows='[]',max_posts_per_day=3,min_post_spacing_minutes=60",
  );
  w.exec(
    "UPDATE posts SET scheduled_publish_at=? WHERE id='existing'",
    new Date(Date.now() + 3600000).toISOString(),
  );
  let once = false;
  afterRead(
    w,
    (sql) => sql.includes("SELECT id, scheduled_publish_at FROM posts"),
    "all",
    async (rows) => {
      if (!once) {
        once = true;
        assert.equal(
          (await send(w, "/v1/settings", { workspace: { maxPostsPerDay: 1 } })).status,
          200,
        );
      }
      return rows;
    },
  );
  assert.equal((await send(w, "/v1/posts/a/resume")).status, 200);
  const day = (value) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Indiana/Indianapolis" }).format(
      new Date(value),
    );
  assert.notEqual(
    day(w.row("SELECT scheduled_publish_at FROM posts WHERE id='a'").scheduled_publish_at),
    day(w.row("SELECT scheduled_publish_at FROM posts WHERE id='existing'").scheduled_publish_at),
  );
});

test("a stale generation cancel cannot cancel a job after retry returns it to the same status", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status,control_token) VALUES('job','client-a','[]','queued','old')",
  );
  let once = false;
  afterRead(
    w,
    (sql) => sql === "SELECT * FROM generation_jobs WHERE id=?",
    "first",
    (row) => {
      if (!once) {
        once = true;
        w.exec("UPDATE generation_jobs SET control_token='new-retry' WHERE id='job'");
      }
      return row;
    },
  );
  assert.equal((await send(w, "/v1/generation-jobs/job/cancel")).status, 409);
  assert.equal(w.row("SELECT status FROM generation_jobs").status, "queued");
});

test("recovery queue failures become actionable failed jobs instead of silently queued work", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status,stage_updated_at) VALUES('job','client-a','[]','queued','2000-01-01')",
  );
  w.env.GENERATION_QUEUE.send = async () => {
    throw Error("Fixture unavailable");
  };
  await recoverStaleWork(w.env);
  assert.equal(w.row("SELECT status FROM generation_jobs").status, "failed");
  assert.match(w.row("SELECT error_message FROM generation_jobs").error_message, /Retry/);
});

for (const policy of ["hold", "skip", "bad-legacy-policy"])
  test(`cron ${policy} cannot apply its stale decision to a new schedule version`, async (t) => {
    const w = workspace(t);
    scheduled(w);
    w.exec(
      "UPDATE posts SET scheduled_publish_at='2000-01-01',prepublish_alert_at=CURRENT_TIMESTAMP WHERE id='post'",
    );
    w.exec("UPDATE workspace_settings SET default_no_response_policy=?", policy);
    afterRead(
      w,
      (sql) => sql.includes("SELECT p.id, p.prepublish_response, p.publish_version"),
      "all",
      (rows) => {
        w.exec(
          "UPDATE posts SET publish_version=publish_version+1,scheduled_publish_at='2030-01-01' WHERE id='post'",
        );
        return rows;
      },
    );
    await worker.scheduled({}, w.env);
    assert.equal(w.row("SELECT status FROM posts WHERE id='post'").status, "calendar_scheduled");
    assert.equal(w.published.length, 0);
  });

test("an invalid legacy no-response policy holds publishing closed", async (t) => {
  const w = workspace(t);
  scheduled(w);
  w.exec(
    "UPDATE posts SET scheduled_publish_at='2000-01-01',prepublish_alert_at=CURRENT_TIMESTAMP WHERE id='post'",
  );
  w.exec("UPDATE workspace_settings SET default_no_response_policy='invalid'");
  await worker.scheduled({}, w.env);
  assert.equal(w.row("SELECT status FROM posts WHERE id='post'").status, "paused");
  assert.equal(w.published.length, 0);
});

test("contradicting provider receipts block absence reconciliation, retries and queue claims", async (t) => {
  const w = workspace(t);
  unknown(w);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status) VALUES('social','client-a','facebook','page','connected')",
  );
  w.exec("UPDATE posts SET social_account_id='social' WHERE id='post'");
  w.exec(
    "INSERT INTO social_publish_receipts(id,post_id,social_account_id,provider_post_id,status) VALUES('receipt','post','social','live','published')",
  );
  assert.equal(
    (await send(w, "/v1/system/posts/post/reconcile", { ...proof, outcome: "absent" })).status,
    409,
  );
  w.exec("UPDATE posts SET failure_code='PUBLISH_CONFIRMED_ABSENT' WHERE id='post'");
  assert.equal((await send(w, "/v1/system/posts/post/retry")).status, 409);
  w.exec(
    "UPDATE posts SET status='calendar_scheduled',prepublish_response='publish_now' WHERE id='post'",
  );
  const job = await ensurePublishJob(w.env, "post");
  assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, false);
});

test("an expired generation planner cannot overwrite a recovered plan or create extra campaigns", async (t) => {
  const w = workspace(t);
  source(w);
  w.objects.set("a.jpg", "fixture");
  const created = await (await send(w, "/v1/generation-jobs", creation)).json();
  const newer = {
    campaignName: "Recovered plan",
    posts: [
      {
        platform: "facebook",
        headline: "New",
        caption: "New",
        hashtags: [],
        objective: "Auto",
        cta: "Visit",
        visualDirection: "New",
      },
    ],
  };
  t.mock.method(globalThis, "fetch", async () => {
    w.exec("UPDATE generation_jobs SET stage_updated_at='2000-01-01' WHERE id=?", created.jobId);
    await recoverStaleWork(w.env);
    w.exec(
      "UPDATE generation_jobs SET plan_json=? WHERE id=?",
      JSON.stringify(newer),
      created.jobId,
    );
    return Response.json({
      output_text: JSON.stringify({ ...newer, campaignName: "Expired plan" }),
    });
  });
  const result = await runGenerationJob(w.env, created.jobId);
  assert.equal(result.claimed, false);
  assert.equal(
    JSON.parse(w.row("SELECT plan_json FROM generation_jobs").plan_json).campaignName,
    "Recovered plan",
  );
  assert.equal(w.row("SELECT COUNT(*) AS n FROM campaigns").n, 0);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM posts").n, 0);
  assert.equal(w.row("SELECT status FROM generation_jobs").status, "queued");
});

test("a recovered graphic worker cannot replace newer media, variants, scores or job state", async (t) => {
  const w = workspace(t);
  w.post("image", "client-a", "review_ready");
  const plan = {
    posts: [
      {
        platform: "facebook",
        headline: "Headline",
        caption: "Caption",
        hashtags: [],
        objective: "Auto",
        cta: "Visit",
        visualDirection: "Bright",
      },
    ],
  };
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status,plan_json,post_ids) VALUES('job','client-a','[]','rendering',?,?)",
    JSON.stringify(plan),
    JSON.stringify(["image"]),
  );
  w.exec("UPDATE posts SET generation_job_id='job' WHERE id='image'");
  w.exec(
    "INSERT INTO graphic_jobs(id,generation_job_id,post_id,status) VALUES('graphic','job','image','queued')",
  );
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (JSON.parse(init.body).tools) {
      w.exec("UPDATE graphic_jobs SET updated_at='2000-01-01' WHERE id='graphic'");
      await recoverStaleWork(w.env);
      w.exec("UPDATE posts SET graphic_key='new.jpg',sparq_score=99 WHERE id='image'");
      return Response.json({
        output: [
          { type: "image_generation_call", result: Buffer.from("old image").toString("base64") },
        ],
      });
    }
    return Response.json({
      output_text: JSON.stringify({
        overall: 80,
        brandMatch: 80,
        readability: 80,
        platformFit: 80,
        ctaStrength: 80,
        composition: 80,
        captionQuality: 80,
        compliance: 80,
        rationale: "Fixture",
      }),
    });
  });
  await runGraphicJob(w.env, "graphic");
  assert.equal(w.row("SELECT graphic_key FROM posts").graphic_key, "new.jpg");
  assert.equal(w.row("SELECT sparq_score FROM posts").sparq_score, 99);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM creative_variants").n, 0);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM sparq_scores").n, 0);
  assert.equal(w.row("SELECT status FROM graphic_jobs").status, "retrying");
});

test("terminal graphic recovery cannot fail a job completed after its stale read", async (t) => {
  const w = workspace(t);
  w.post("image", "client-a", "review_ready");
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status) VALUES('job','client-a','[]','rendering')",
  );
  w.exec(
    "INSERT INTO graphic_jobs(id,generation_job_id,post_id,status,attempt_count,updated_at) VALUES('graphic','job','image','processing',3,'2000-01-01')",
  );
  afterRead(
    w,
    (sql) => sql.includes("SELECT id,generation_job_id,status,attempt_count,updated_at"),
    "all",
    (rows) => {
      w.exec("UPDATE graphic_jobs SET status='completed' WHERE id='graphic'");
      return rows;
    },
  );
  await recoverStaleWork(w.env);
  assert.equal(w.row("SELECT status FROM graphic_jobs").status, "completed");
  assert.equal(w.row("SELECT status FROM posts").status, "review_ready");
});

test("generation finalization cannot complete a job canceled after its read", async (t) => {
  const w = workspace(t);
  w.post("image", "client-a", "review_ready");
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status) VALUES('job','client-a','[]','rendering')",
  );
  w.exec("UPDATE posts SET generation_job_id='job' WHERE id='image'");
  afterRead(
    w,
    (sql) => sql.includes("SELECT g.*,c.name AS client_name,campaigns.name AS campaign_name"),
    "first",
    (row) => {
      w.exec(
        "UPDATE generation_jobs SET status='canceled',control_token='canceled' WHERE id='job'",
      );
      return row;
    },
  );
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "email" }));
  assert.equal((await finalizeGenerationReview(w.env, "job")).ready, false);
  assert.equal(w.row("SELECT status FROM generation_jobs").status, "canceled");
  assert.equal(w.row("SELECT status FROM posts").status, "review_ready");
});

test("malformed or null settings cannot create defaults or silently succeed", async (t) => {
  const w = workspace(t);
  for (const body of ["{broken", "null"]) {
    const response = await worker.fetch(
      new Request(w.env.PUBLIC_BASE_URL + "/v1/settings", {
        method: "POST",
        headers: { authorization: "Bearer owner-token", "content-type": "application/json" },
        body,
      }),
      w.env,
    );
    assert.equal(response.status, 400);
  }
  assert.equal(w.row("SELECT COUNT(*) AS n FROM notification_preferences").n, 0);
});

test("partial workspace or notification updates cannot accidentally override a workspace publishing hold", async (t) => {
  const w = workspace(t);
  w.exec(
    "UPDATE workspace_settings SET default_no_response_policy='hold',default_prepublish_minutes=60",
  );
  assert.equal((await send(w, "/v1/settings", { workspace: { maxPostsPerDay: 5 } })).status, 200);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM notification_preferences").n, 0);
  assert.equal(
    (await send(w, "/v1/settings", { notifications: { emailEnabled: false } })).status,
    200,
  );
  const prefs = w.row("SELECT no_response_policy,prepublish_minutes FROM notification_preferences");
  assert.equal(prefs.no_response_policy, "hold");
  assert.equal(prefs.prepublish_minutes, 60);
});

import test from "node:test";
import assert from "node:assert/strict";
import { workspace, digest } from "./workspace.mjs";
import { runRevisionJob, recoverRevisionJobs } from "../cloudflare/src/generation.ts";
import { ensurePublishJob, claimPublishJob } from "../cloudflare/src/publishing.ts";
import worker from "../cloudflare/src/index.ts";
import { encryptSecret } from "../cloudflare/src/security.ts";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function interceptCalendar(w, callback) {
  const prepare = w.env.DB.prepare;
  w.env.DB.prepare = (sql) => {
    const wrap = (statement) => {
      const bind = statement.bind;
      statement.bind = (...args) => wrap(bind(...args));
      if (sql.includes("SELECT id, scheduled_publish_at FROM posts")) {
        const all = statement.all;
        statement.all = async () => callback(await all.call(statement));
      }
      return statement;
    };
    return wrap(prepare(sql));
  };
}
const send = (w, path, body) => w.request(path, { user: "owner", method: "POST", body });
function destination(w) {
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status) VALUES ('social','client-a','facebook','test-page','connected')",
  );
}

test("a revision returning after timeout and a newer manual edit cannot overwrite it", async (t) => {
  const w = workspace(t);
  w.post("late");
  await send(w, "/v1/posts/late/ai-rewrite-caption", {});
  const started = deferred(),
    release = deferred();
  t.mock.method(globalThis, "fetch", async () => {
    started.resolve();
    await release.promise;
    return Response.json({
      output_text: JSON.stringify({
        headline: "Stale AI",
        caption: "Stale AI caption",
        hashtags: [],
      }),
    });
  });
  const running = runRevisionJob(w.env, w.generated[0].revisionJobId);
  await started.promise;
  w.exec("UPDATE revision_jobs SET claimed_at='2000-01-01' WHERE post_id='late'");
  await recoverRevisionJobs(w.env);
  assert.equal(
    (await send(w, "/v1/posts/late/edit", { headline: "Operator edit", caption: "Keep my edit" }))
      .status,
    200,
  );
  release.resolve();
  await running;
  assert.equal(w.row("SELECT caption FROM posts WHERE id='late'").caption, "Keep my edit");
  assert.equal(w.row("SELECT status FROM revision_jobs WHERE post_id='late'").status, "failed");
});

test("an expired graphic revision cannot replace newer graphics, variants or scores", async (t) => {
  const w = workspace(t);
  w.post("image");
  const started = deferred(),
    release = deferred();
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (JSON.parse(init.body).tools) {
      started.resolve();
      await release.promise;
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
  await send(w, "/v1/posts/image/ai-edit-image", { instruction: "Brighten" });
  assert.equal(w.generated.length, 1);
  const running = runRevisionJob(w.env, w.generated[0].revisionJobId);
  await started.promise;
  w.exec("UPDATE revision_jobs SET claimed_at='2000-01-01'");
  await recoverRevisionJobs(w.env);
  w.exec("UPDATE posts SET graphic_key='new.jpg',sparq_score=99 WHERE id='image'");
  release.resolve();
  await running;
  assert.equal(w.row("SELECT graphic_key FROM posts WHERE id='image'").graphic_key, "new.jpg");
  assert.equal(w.row("SELECT sparq_score FROM posts WHERE id='image'").sparq_score, 99);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM creative_variants").n, 0);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM sparq_scores").n, 0);
});

test("reschedule losing to a publisher cannot claim success even when the provider finishes later", async (t) => {
  const w = workspace(t);
  w.post("publishing", "client-a", "calendar_scheduled");
  destination(w);
  w.exec(
    "UPDATE social_accounts SET access_token_ciphertext=?",
    await encryptSecret("fixture", w.env),
  );
  w.exec(
    "UPDATE posts SET social_account_id='social',graphic_key='image.jpg' WHERE id='publishing'",
  );
  w.objects.set("image.jpg", "fixture");
  const job = await ensurePublishJob(w.env, "publishing");
  const started = deferred(),
    release = deferred();
  let publishing;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).startsWith("https://graph.facebook.com/")) {
      started.resolve();
      await release.promise;
      return Response.json({ id: "photo", post_id: "provider-post" });
    }
    assert.equal(url, "https://api.resend.com/emails");
    return Response.json({ id: "email" });
  });
  interceptCalendar(w, async (rows) => {
    if (!publishing) {
      publishing = worker.queue(
        {
          messages: [
            {
              body: {
                kind: "publish",
                postId: "publishing",
                publishJobId: job.jobId,
                executionKey: job.executionKey,
              },
              attempts: 1,
              ack() {},
              retry() {
                throw Error("Unexpected retry");
              },
            },
          ],
        },
        w.env,
      );
      await started.promise;
    }
    return rows;
  });
  const result = await send(w, "/v1/posts/publishing/reschedule", {
    scheduledPublishAt: new Date(Date.now() + 86400000).toISOString(),
  });
  release.resolve();
  await publishing;
  assert.equal(result.status, 409);
  assert.equal(w.row("SELECT status FROM posts WHERE id='publishing'").status, "published");
  assert.equal(
    w.row("SELECT platform_post_id FROM posts WHERE id='publishing'").platform_post_id,
    "provider-post",
  );
});

test("a publisher claiming after reschedule reads the post makes reschedule fail without canceling it", async (t) => {
  const w = workspace(t);
  w.post("race", "client-a", "calendar_scheduled");
  const job = await ensurePublishJob(w.env, "race");
  let claimed = false;
  interceptCalendar(w, async (rows) => {
    if (!claimed) {
      claimed = true;
      assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, true);
    }
    return rows;
  });
  const result = await send(w, "/v1/posts/race/reschedule", {
    scheduledPublishAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(claimed, true);
  assert.equal(result.status, 409);
  assert.equal(w.row("SELECT status FROM publish_jobs WHERE id=?", job.jobId).status, "publishing");
  assert.equal(w.row("SELECT publish_version FROM posts WHERE id='race'").publish_version, 1);
});

test("two approvals that select against the same calendar reserve distinct spaced slots", async (t) => {
  const w = workspace(t);
  destination(w);
  w.post("a");
  w.post("b");
  w.exec(
    "UPDATE posts SET social_account_id='social',suggested_publish_at='2030-01-07T15:00:00.000Z'",
  );
  const bothSelected = deferred();
  let selections = 0;
  interceptCalendar(w, async (rows) => {
    if (++selections <= 2) {
      if (selections === 2) bothSelected.resolve();
      await bothSelected.promise;
    }
    return rows;
  });
  const results = await Promise.all([
    send(w, "/v1/posts/a/approve"),
    send(w, "/v1/posts/b/approve"),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  const a = w.row("SELECT scheduled_publish_at FROM posts WHERE id='a'").scheduled_publish_at;
  const b = w.row("SELECT scheduled_publish_at FROM posts WHERE id='b'").scheduled_publish_at;
  assert.ok(Math.abs(Date.parse(a) - Date.parse(b)) >= 180 * 60000);
});

for (const environment of ["staging", "production", undefined, "preview"]) {
  test(`${environment || "missing environment"} denies uninvited first Google user when admission is empty`, async (t) => {
    const w = workspace(t);
    w.exec("DELETE FROM sessions");
    w.exec("DELETE FROM user_client_access");
    w.exec("DELETE FROM users");
    w.env.ENVIRONMENT = environment;
    w.env.AUTH_ALLOWED_EMAILS = "";
    t.mock.method(globalThis, "fetch", async (url) =>
      String(url).includes("/tokeninfo")
        ? Response.json({
            aud: w.env.GOOGLE_CLIENT_ID,
            iss: "https://accounts.google.com",
            sub: "unknown",
            email: "uninvited@example.test",
            email_verified: true,
          })
        : Response.json({ id_token: "fixture" }),
    );
    const start = await w.request("/v1/auth/google/start");
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const result = await w.request(`/v1/auth/google/callback?state=${state}&code=fixture`);
    assert.ok(new URL(result.headers.get("location")).searchParams.has("auth_error"));
    assert.equal(w.row("SELECT COUNT(*) AS n FROM users").n, 0);
    assert.equal(w.row("SELECT COUNT(*) AS n FROM google_auth_handoffs").n, 0);
  });
}

test("public and bulk approvals also serialize the daily cap against the same calendar", async (t) => {
  const w = workspace(t);
  destination(w);
  w.post("public");
  w.post("bulk");
  w.exec("UPDATE workspace_settings SET max_posts_per_day=1 WHERE id='default'");
  w.exec(
    "UPDATE posts SET social_account_id='social',suggested_publish_at='2030-01-07T15:00:00.000Z'",
  );
  w.exec(
    "INSERT INTO review_tokens(id,post_id,token_hash,recipient_email,expires_at,created_at) VALUES ('token','public',?,'reviewer@example.test',?,?)",
    digest(`${w.env.AUTH_PEPPER}:review:acceptance`),
    Date.now() + 60000,
    Date.now(),
  );
  const both = deferred();
  let selections = 0;
  interceptCalendar(w, async (rows) => {
    if (++selections <= 2) {
      if (selections === 2) both.resolve();
      await both.promise;
    }
    return rows;
  });
  const [publicResult, bulkResult] = await Promise.all([
    w.request("/v1/public/review/acceptance/approve", { method: "POST" }),
    send(w, "/v1/posts/bulk/approve", { postIds: ["bulk"] }),
  ]);
  assert.equal(publicResult.status, 200);
  assert.equal((await bulkResult.json()).results[0].ok, true);
  const date = (id) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Indiana/Indianapolis" }).format(
      new Date(w.row("SELECT scheduled_publish_at FROM posts WHERE id=?", id).scheduled_publish_at),
    );
  assert.notEqual(date("public"), date("bulk"));
  assert.equal(w.row("SELECT COUNT(*) AS n FROM approvals").n, 2);
  assert.ok(w.row("SELECT used_at FROM review_tokens WHERE id='token'").used_at);
});

test("concurrent explicitly admitted bootstrap users create exactly one owner", async (t) => {
  const w = workspace(t);
  w.exec("DELETE FROM sessions");
  w.exec("DELETE FROM user_client_access");
  w.exec("DELETE FROM users");
  w.env.ENVIRONMENT = "staging";
  w.env.AUTH_ALLOWED_EMAILS = "one@example.test,two@example.test";
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (!String(url).includes("/tokeninfo"))
      return Response.json({ id_token: new URLSearchParams(init.body).get("code") });
    const identity = new URL(url).searchParams.get("id_token");
    return Response.json({
      aud: w.env.GOOGLE_CLIENT_ID,
      iss: "https://accounts.google.com",
      sub: identity,
      email: `${identity}@example.test`,
      email_verified: true,
    });
  });
  const starts = await Promise.all([
    w.request("/v1/auth/google/start"),
    w.request("/v1/auth/google/start"),
  ]);
  const responses = await Promise.all(
    starts.map((start, index) => {
      const state = new URL(start.headers.get("location")).searchParams.get("state");
      return w.request(`/v1/auth/google/callback?state=${state}&code=${index ? "two" : "one"}`);
    }),
  );
  assert.ok(
    responses.every((response) =>
      new URL(response.headers.get("location")).searchParams.has("handoff"),
    ),
  );
  assert.equal(w.row("SELECT COUNT(*) AS n FROM users WHERE role='owner'").n, 1);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM users").n, 2);
});

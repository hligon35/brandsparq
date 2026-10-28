import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/src/index.ts";
import { notifyPostOwners } from "../cloudflare/src/notifications.ts";
import {
  inBlackoutWindow,
  inPreferredWindow,
  validateSchedule,
} from "../cloudflare/src/scheduling.ts";
import { workspace, digest, withCurrentRevision } from "./workspace.mjs";
import { runGenerationJob, runGraphicJob, sendReviewLinks } from "../cloudflare/src/generation.ts";

async function call(w, path, body, user = "owner") {
  return w.request(path, { user, method: "POST", body: withCurrentRevision(w, path, body) });
}
async function google(w, t, email) {
  t.mock.method(globalThis, "fetch", async (url) =>
    url === "https://oauth2.googleapis.com/token"
      ? Response.json({ id_token: "verified-token" })
      : Response.json({
          aud: w.env.GOOGLE_CLIENT_ID,
          iss: "https://accounts.google.com",
          sub: "google-" + email,
          email,
          email_verified: true,
          name: "Invited teammate",
        }),
  );
  const start = await w.request("/v1/auth/google/start");
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  return w.request("/v1/auth/google/callback?state=" + state + "&code=fixture");
}

test("explicit client roles override workspace roles without granting workspace-owner controls", async (t) => {
  const w = workspace(t);
  w.post("review-a");
  w.post("review-b", "client-b");
  w.exec("UPDATE user_client_access SET permission_role='reviewer' WHERE user_id='viewer'");
  assert.equal(
    (await call(w, "/v1/posts/review-a/edit", { caption: "Allowed review" }, "viewer")).status,
    200,
  );
  assert.equal((await call(w, "/v1/posts/review-a/publish-now", {}, "viewer")).status, 403);
  assert.equal(
    (await call(w, "/v1/posts/review-b/edit", { caption: "Denied" }, "viewer")).status,
    403,
  );
  assert.equal(
    (await call(w, "/v1/settings", { workspace: { timezone: "UTC" } }, "viewer")).status,
    403,
  );
  assert.deepEqual(
    (await (await w.request("/v1/auth/session", { user: "viewer" })).json()).user.clientRoles,
    { "client-a": "reviewer" },
  );
  assert.equal(
    (
      await call(w, "/v1/system/users/viewer/clients/client-b", {
        enabled: true,
        accessRole: "owner",
      })
    ).status,
    400,
  );
});

test("invitations are email-bound, expire and grant only selected client roles on verified Google sign-in", async (t) => {
  const w = workspace(t);
  let emailBody;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    emailBody = JSON.parse(init.body);
    return Response.json({ id: "email" });
  });
  assert.equal(
    (
      await call(
        w,
        "/v1/team/invitations",
        { email: "new@example.test", role: "reviewer", clientRoles: { "client-a": "reviewer" } },
        "viewer",
      )
    ).status,
    403,
  );
  const result = await call(w, "/v1/team/invitations", {
    email: "new@example.test",
    role: "reviewer",
    clientRoles: { "client-a": "reviewer" },
  });
  assert.equal(result.status, 201);
  assert.deepEqual(emailBody.to, ["new@example.test"]);
  const token = emailBody.html.match(/\/invite\/([a-f0-9]+)/)[1];
  assert.equal((await w.request("/v1/public/invitations/" + token)).status, 200);
  const wrong = await google(w, t, "stranger@example.test");
  assert.ok(new URL(wrong.headers.get("location")).searchParams.get("auth_error"));
  assert.equal(
    w.row("SELECT status FROM team_invitations WHERE email='new@example.test'").status,
    "pending",
  );
  const returned = await google(w, t, "new@example.test");
  const handoff = new URL(returned.headers.get("location")).searchParams.get("handoff");
  assert.ok(handoff);
  const completed = await call(w, "/v1/auth/google/complete", { handoff }, undefined);
  const session = await completed.json();
  assert.equal(completed.status, 200);
  assert.equal(session.user.role, "reviewer");
  const data = await (
    await worker.fetch(
      new Request(w.env.PUBLIC_BASE_URL + "/v1/auth/session", {
        headers: { authorization: "Bearer " + session.token },
      }),
      w.env,
    )
  ).json();
  assert.deepEqual(data.user.clientRoles, { "client-a": "reviewer" });
  assert.equal((await w.request("/v1/public/invitations/" + token)).status, 404);
  assert.equal(
    w.row("SELECT COUNT(*) AS n FROM user_client_access WHERE user_id=?", session.user.id).n,
    1,
  );
});

test("revoking, expiring and resending invitations invalidates the prior link and preserves inactive onboarding", async (t) => {
  const w = workspace(t);
  let token;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    token = JSON.parse(init.body).html.match(/\/invite\/([a-f0-9]+)/)[1];
    return Response.json({ id: "email" });
  });
  const first = await (
    await call(w, "/v1/team/invitations", {
      email: "invite@example.test",
      role: "viewer",
      clientRoles: {},
    })
  ).json();
  const old = token;
  assert.equal((await call(w, `/v1/team/invitations/${first.id}/resend`, {})).status, 201);
  assert.equal((await w.request("/v1/public/invitations/" + old)).status, 404);
  assert.equal((await w.request("/v1/public/invitations/" + token)).status, 200);
  w.exec("UPDATE team_invitations SET expires_at=0 WHERE status='pending'");
  assert.equal((await w.request("/v1/public/invitations/" + token)).status, 404);
  const response = await google(w, t, "invite@example.test");
  assert.ok(new URL(response.headers.get("location")).searchParams.get("auth_error"));
  assert.equal(
    w.row("SELECT status FROM users WHERE email='invite@example.test'").status,
    "invited",
  );
});

test("suspension and removal revoke sessions, handoffs, push devices and public review access", async (t) => {
  const w = workspace(t);
  w.post("post");
  w.exec(
    "INSERT INTO device_push_tokens(id,user_id,expo_push_token) VALUES ('device','viewer','ExponentPushToken[fixture]')",
  );
  w.exec(
    "INSERT INTO review_tokens(id,post_id,token_hash,recipient_email,expires_at,created_at) VALUES ('token','post',?,'viewer@example.test',?,?)",
    digest(w.env.AUTH_PEPPER + ":review:review-secret"),
    Date.now() + 60000,
    Date.now(),
  );
  w.exec(
    "INSERT INTO client_reviewers(id,client_id,email) VALUES ('r','client-a','viewer@example.test')",
  );
  assert.equal(
    (await call(w, "/v1/team/users/viewer/status", { status: "suspended" })).status,
    200,
  );
  assert.equal((await w.request("/v1/auth/session", { user: "viewer" })).status, 401);
  assert.equal(w.row("SELECT enabled FROM device_push_tokens WHERE id='device'").enabled, 0);
  assert.equal((await w.request("/v1/public/review/review-secret")).status, 404);
  assert.equal(w.row("SELECT enabled FROM client_reviewers WHERE id='r'").enabled, 0);
  assert.equal((await call(w, "/v1/team/users/owner/status", { status: "removed" })).status, 409);
  assert.equal((await call(w, "/v1/system/users/owner/role", { role: "viewer" })).status, 409);
  assert.equal((await call(w, "/v1/team/users/viewer/status", { status: "active" })).status, 200);
  assert.equal((await w.request("/v1/auth/session", { user: "viewer" })).status, 401);
});

test("campaign patches validate dates and preserve omitted metadata", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO campaigns(id,client_id,name,objective,status,starts_at,ends_at,notes,priority) VALUES ('campaign','client-a','Original','Awareness','active','2026-10-01','2026-11-01','Keep notes',5)",
  );
  assert.equal((await call(w, "/v1/campaigns/campaign", { name: "Updated" })).status, 200);
  assert.equal(w.row("SELECT notes FROM campaigns WHERE id='campaign'").notes, "Keep notes");
  for (const body of [
    { startsAt: "2026-12-01", endsAt: "2026-10-01" },
    { priority: 101 },
    { status: "unknown" },
    { name: "" },
  ])
    assert.equal((await call(w, "/v1/campaigns/campaign", body)).status, 400);
  assert.equal((await call(w, "/v1/campaigns/campaign", { name: "Denied" }, "viewer")).status, 403);
});

test("job progress isolates clients; retry preserves identity and cancel fences queued graphics", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status) VALUES ('job-a','client-a','[]','failed'),('job-b','client-b','[]','queued')",
  );
  assert.deepEqual(
    (await (await w.request("/v1/generation-jobs", { user: "viewer" })).json()).data.map(
      (j) => j.id,
    ),
    ["job-a"],
  );
  assert.equal((await w.request("/v1/generation-jobs/job-b", { user: "viewer" })).status, 404);
  assert.equal((await call(w, "/v1/generation-jobs/job-a/retry", {}, "viewer")).status, 403);
  assert.equal((await call(w, "/v1/generation-jobs/job-a/retry", {})).status, 200);
  assert.equal(w.generated[0].jobId, "job-a");
  assert.equal((await call(w, "/v1/generation-jobs/job-a/retry", {})).status, 409);
  assert.equal((await call(w, "/v1/generation-jobs/job-a/cancel", {})).status, 200);
  assert.equal(w.row("SELECT status FROM generation_jobs WHERE id='job-a'").status, "canceled");
  await runGenerationJob(w.env, "job-a");
  assert.equal(w.row("SELECT COUNT(*) AS n FROM campaigns").n, 0);
  w.exec("UPDATE generation_jobs SET status='processing' WHERE id='job-a'");
  assert.equal((await call(w, "/v1/generation-jobs/job-a/cancel", {})).status, 409);
});

test("restoring a client never resumes publishing automatically; approved and unapproved paused posts take separate paths", async (t) => {
  const w = workspace(t);
  w.post("approved", "client-a", "paused");
  w.post("unfinished", "client-a", "paused");
  w.exec(
    "UPDATE posts SET approved_at='2026-10-01',scheduled_publish_at='2026-10-01' WHERE id='approved'",
  );
  w.exec("UPDATE posts SET graphic_key='graphic.jpg' WHERE id='unfinished'");
  w.exec("UPDATE clients SET status='archived' WHERE id='client-a'");
  assert.equal((await call(w, "/v1/posts/approved/resume", {})).status, 403);
  assert.equal((await call(w, "/v1/clients/client-a/restore", {})).status, 200);
  assert.equal(w.published.length, 0);
  assert.equal(w.row("SELECT status FROM posts WHERE id='approved'").status, "paused");
  assert.equal((await call(w, "/v1/posts/unfinished/resume", {})).status, 409);
  assert.equal((await call(w, "/v1/posts/unfinished/restore-review", {})).status, 200);
  assert.equal((await call(w, "/v1/posts/approved/resume", {})).status, 200);
  assert.ok(
    Date.parse(
      w.row("SELECT scheduled_publish_at FROM posts WHERE id='approved'").scheduled_publish_at,
    ) > Date.now(),
  );
  assert.equal(w.row("SELECT status FROM posts WHERE id='unfinished'").status, "awaiting_approval");
});

test("brand attachment removal keeps originals and clears only the relevant selected logo", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO assets(id,client_id,r2_key,filename,content_type) VALUES ('asset','client-a','original','original.png','image/png')",
  );
  await call(w, "/v1/clients/client-a/brand", { voice: "Brand", logoPreference: "alternate" });
  await call(w, "/v1/clients/client-a/brand-assets", { assetId: "asset", role: "logo" });
  await call(w, "/v1/clients/client-a/brand-assets", { assetId: "asset", role: "alternate_logo" });
  const id = w.row("SELECT id FROM brand_assets WHERE role='logo'").id;
  assert.equal((await call(w, `/v1/clients/client-a/brand-assets/${id}/remove`, {})).status, 200);
  const row = w.row(
    "SELECT logo_asset_id,alternate_logo_asset_id,logo_preference FROM brand_profiles WHERE client_id='client-a'",
  );
  assert.equal(row.logo_asset_id, null);
  assert.equal(row.alternate_logo_asset_id, "asset");
  assert.equal(row.logo_preference, "alternate");
  assert.equal(w.row("SELECT COUNT(*) AS n FROM assets WHERE id='asset'").n, 1);
});

test("client reviewers receive distinct revocable links and delivery failures remain visible", async (t) => {
  const w = workspace(t);
  w.env.REVIEW_BASE_URL = w.env.PUBLIC_BASE_URL;
  w.post("review");
  const messages = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    messages.push(body);
    return body.to[0] === "fail@example.test"
      ? Response.json({ message: "Rejected" }, { status: 403 })
      : Response.json({ id: "email" });
  });
  await call(w, "/v1/clients/client-a/reviewers", { email: "reviewer@example.test" });
  await call(w, "/v1/clients/client-a/reviewers", { email: "fail@example.test" });
  const first = await (await call(w, "/v1/clients/client-a/review-links", {})).json();
  assert.deepEqual(first.data, { sent: 1, failed: 1 });
  assert.equal(messages.length, 2);
  const tokens = messages.map((m) => m.html.match(/\/review\/([a-f0-9]+)/)[1]);
  assert.notEqual(tokens[0], tokens[1]);
  assert.equal((await w.request("/v1/public/review/" + tokens[0])).status, 200);
  await call(w, "/v1/clients/client-a/reviewers", { email: messages[0].to[0], enabled: false });
  assert.equal((await w.request("/v1/public/review/" + tokens[0])).status, 404);
  const history = await (
    await w.request("/v1/clients/client-a/review-links", { user: "owner" })
  ).json();
  assert.equal(history.data.deliveries.length, 2);
  assert.ok(history.data.deliveries.some((d) => d.status === "failed"));
  assert.equal(
    (await w.request("/v1/clients/client-a/review-links", { user: "viewer" })).status,
    403,
  );
});

test("push unregister affects only the current user device", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO device_push_tokens(id,user_id,expo_push_token) VALUES ('a','owner','ExponentPushToken[a]'),('b','viewer','ExponentPushToken[b]')",
  );
  await call(w, "/v1/push-token/unregister", { token: "ExponentPushToken[a]" }, "viewer");
  assert.equal(w.row("SELECT enabled FROM device_push_tokens WHERE id='a'").enabled, 1);
  await call(w, "/v1/push-token/unregister", { token: "ExponentPushToken[b]" }, "viewer");
  assert.equal(w.row("SELECT enabled FROM device_push_tokens WHERE id='b'").enabled, 0);
});

test("access overview exposes effective client roles for the owner", async (t) => {
  const w = workspace(t);
  w.exec("UPDATE user_client_access SET permission_role='publisher' WHERE user_id='viewer'");
  const response = await w.request("/v1/system/access", { user: "owner" });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.access[0].access_role, "publisher");
  assert.ok(data.users.every((u) => u.status === "active"));
});

test("planning and graphics include approved references and the selected alternate logo", async (t) => {
  const w = workspace(t);
  w.env.REVIEW_BASE_URL = w.env.PUBLIC_BASE_URL;
  for (const id of ["source", "reference", "primary", "alternate"]) {
    w.exec(
      "INSERT INTO assets(id,client_id,r2_key,filename,content_type,size_bytes) VALUES (?,'client-a',?,?, 'image/png',20)",
      id,
      id,
      id + ".png",
    );
    w.objects.set(id, Buffer.from(id));
  }
  await call(w, "/v1/clients/client-a/brand", { voice: "Friendly", logoPreference: "alternate" });
  for (const [assetId, role] of [
    ["reference", "reference"],
    ["primary", "logo"],
    ["alternate", "alternate_logo"],
  ])
    await call(w, "/v1/clients/client-a/brand-assets", { assetId, role });
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status) VALUES ('creative','client-a','[\"source\"]','queued')",
  );
  const plan = {
    campaignName: "Brand campaign",
    posts: [
      {
        platform: "facebook",
        headline: "Community",
        caption: "Local",
        hashtags: [],
        cta: "Learn more",
        objective: "Awareness",
        visualDirection: "Clean",
        suggestedPublishAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ],
  };
  let planned = false,
    rendered = false;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "https://api.resend.com/emails") return Response.json({ id: "email" });
    const sent = JSON.parse(init.body);
    const images = sent.input[0].content
      .filter((c) => c.type === "input_image")
      .map((c) => c.image_url);
    const data = (id) => "data:image/png;base64," + Buffer.from(id).toString("base64");
    if (sent.tools) {
      assert.ok(images.includes(data("reference")));
      assert.ok(images.includes(data("alternate")));
      assert.equal(images.includes(data("primary")), false);
      rendered = true;
      return Response.json({
        output: [
          {
            type: "image_generation_call",
            result: Buffer.from("generated jpeg").toString("base64"),
          },
        ],
      });
    }
    if (sent.text.format.name === "brandsparq_campaign") {
      planned = true;
      assert.ok(images.includes(data("source")));
      assert.ok(images.includes(data("reference")));
      return Response.json({ output_text: JSON.stringify(plan) });
    }
    return Response.json({
      output_text: JSON.stringify({
        overall: 85,
        brandMatch: 85,
        readability: 85,
        platformFit: 85,
        ctaStrength: 85,
        composition: 85,
        captionQuality: 85,
        compliance: 85,
        rationale: "Fixture score",
      }),
    });
  });
  await runGenerationJob(w.env, "creative");
  await runGraphicJob(
    w.env,
    w.row("SELECT id FROM graphic_jobs WHERE generation_job_id='creative'").id,
  );
  assert.equal(planned, true);
  assert.equal(rendered, true);
  assert.equal(w.row("SELECT status FROM generation_jobs WHERE id='creative'").status, "completed");
});

test("post notifications follow effective client review and publishing roles", async (t) => {
  const w = workspace(t);
  w.post("notice-a");
  w.exec(
    "INSERT INTO users(id,email,role) VALUES ('reviewer','reviewer@example.test','viewer'),('publisher','publisher@example.test','viewer'),('other','other@example.test','admin')",
  );
  w.exec(
    "INSERT INTO user_client_access(user_id,client_id,permission_role) VALUES ('reviewer','client-a','reviewer'),('publisher','client-a','publisher'),('other','client-b','admin')",
  );
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "email" }));
  await notifyPostOwners(w.env, "notice-a", "review_ready", "Review ready", "Review this post");
  await notifyPostOwners(w.env, "notice-a", "pre_publish", "Publishing soon", "Check schedule");
  assert.deepEqual(
    w.sqlite
      .prepare(
        "SELECT user_id,type FROM notifications WHERE user_id!='owner' ORDER BY user_id,type",
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { user_id: "publisher", type: "pre_publish" },
      { user_id: "reviewer", type: "review_ready" },
    ],
  );
});

test("reconciled uploads inspect image bytes and deduplicate only inside the client", async (t) => {
  const w = workspace(t);
  async function upload(bytes, client = "client-a") {
    return worker.fetch(
      new Request(w.env.PUBLIC_BASE_URL + "/v1/assets", {
        method: "POST",
        headers: {
          authorization: "Bearer owner-token",
          "x-client-id": client,
          "x-file-name": "sample.png",
          "content-type": "image/png",
        },
        body: bytes,
      }),
      w.env,
    );
  }
  assert.equal((await upload("not an image")).status, 415);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh18AAAAASUVORK5CYII=",
    "base64",
  );
  const first = await upload(png);
  assert.equal(first.status, 201);
  const firstId = (await first.json()).data.id;
  const second = await upload(png);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).data.id, firstId);
  assert.equal((await upload(png, "client-b")).status, 201);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM assets").n, 2);
});

test("reconciled schedule windows cross midnight and exclude the edited post", async (t) => {
  assert.equal(inBlackoutWindow(60, ["22:00-02:00"]), true);
  assert.equal(inBlackoutWindow(12 * 60, ["22:00-02:00"]), false);
  assert.equal(inPreferredWindow(23 * 60, ["22:00-02:00"]), true);
  const w = workspace(t);
  w.post("self-slot", "client-a", "calendar_scheduled");
  const slot = new Date(Math.floor((Date.now() + 86400000) / 60000) * 60000).toISOString();
  w.exec(
    "UPDATE workspace_settings SET preferred_windows='[]',blackout_windows='[]',min_post_spacing_minutes=60,max_posts_per_day=1",
  );
  w.exec("UPDATE posts SET scheduled_publish_at=? WHERE id='self-slot'", slot);
  const result = await validateSchedule(w.env, "client-a", slot, "self-slot");
  assert.equal(result.suggested, slot);
});

test("suspended workspace recipients cannot receive fallback review links", async (t) => {
  const w = workspace(t);
  w.post("suspended-review");
  w.exec("UPDATE posts SET graphic_key='graphic.jpg'");
  w.exec("UPDATE users SET status='suspended' WHERE id='owner'");
  w.env.REVIEW_BASE_URL = w.env.PUBLIC_BASE_URL;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ id: "email" });
  });
  assert.deepEqual(await sendReviewLinks(w.env, "client-a"), { sent: 0, failed: 0 });
  assert.equal(calls, 0);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM review_tokens").n, 0);
});

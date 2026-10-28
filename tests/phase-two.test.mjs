import test from "node:test";
import assert from "node:assert/strict";
import { workspace, withCurrentRevision } from "./workspace.mjs";
import { encryptSecret } from "../cloudflare/src/security.ts";
import { runGenerationJob } from "../cloudflare/src/generation.ts";
import { reserveSchedule } from "../cloudflare/src/scheduling.ts";
import { ensurePublishJob, claimPublishJob } from "../cloudflare/src/publishing.ts";
import { ensurePostSocialDestination } from "../cloudflare/src/social.ts";
import { uploadBatch } from "../src/shared/upload-batch.ts";
import { publishActions } from "../src/shared/publish-actions.ts";
import worker from "../cloudflare/src/index.ts";
import { campaignBoundary } from "../cloudflare/src/campaign-workflow.ts";

const send = (w, path, body, user = "owner") =>
  w.request(path, { method: "POST", user, body: withCurrentRevision(w, path, body) });
const request = {
  clientId: "client-a",
  mode: "social",
  outputCount: 1,
  objective: "Promote",
  assetIds: ["source"],
  destinationIds: ["chosen"],
  requestKey: "phase_two_creation_request_1",
};
async function ready(t) {
  const w = workspace(t);
  w.env.META_APP_ID = "fixture-meta";
  w.env.META_APP_SECRET = "fixture-secret";
  w.exec(
    "INSERT INTO brand_profiles(id,client_id,voice,audience) VALUES('brand','client-a','Clear and useful','Local customers')",
  );
  w.exec(
    "INSERT INTO assets(id,client_id,r2_key,filename,content_type) VALUES('source','client-a','source.jpg','source.jpg','image/jpeg')",
  );
  w.objects.set("source.jpg", "fixture");
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,account_name,status,access_token_ciphertext) VALUES('chosen','client-a','facebook','page','Chosen Page','connected',?)",
    await encryptSecret("fixture", w.env),
  );
  return w;
}
const post = (platform = "facebook") => ({
  platform,
  headline: "Headline",
  caption: "Caption",
  hashtags: [],
  cta: "Visit",
  objective: "Promote",
  visualDirection: "Bright",
  suggestedPublishAt: "2030-01-07T15:00:00Z",
});

test("readiness reports actionable brand, configuration and destination gaps without exposing credentials", async (t) => {
  const w = workspace(t);
  const response = await w.request("/v1/clients/client-a/creation-readiness", { user: "owner" });
  const data = (await response.json()).data;
  assert.equal(data.ready, false);
  assert.match(data.blockers.join(" "), /Brand Brain/);
  assert.match(data.blockers.join(" "), /destination/);
  const valid = await ready(t);
  const content = JSON.stringify(
    await (
      await valid.request("/v1/clients/client-a/creation-readiness", { user: "owner" })
    ).json(),
  );
  assert.equal(JSON.parse(content).data.ready, true);
  assert.equal(content.includes("ciphertext"), false);
  assert.equal(content.includes("fixture-secret"), false);
  assert.equal(
    (await valid.request("/v1/clients/client-a/creation-readiness", { user: "viewer" })).status,
    403,
  );
});

test("a single-post request uses a single-post schema and creates one post without a campaign", async (t) => {
  const w = await ready(t);
  let schema;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    schema = body.text.format;
    return Response.json({ output_text: JSON.stringify({ post: post() }) });
  });
  const response = await send(w, "/v1/creation-jobs", request);
  assert.equal(response.status, 202);
  const job = await response.json();
  await runGenerationJob(w.env, job.jobId);
  assert.equal(schema.name, "brandsparq_social_post");
  assert.deepEqual(schema.schema.required, ["post"]);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM posts").n, 1);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM campaigns").n, 0);
  assert.equal(w.row("SELECT social_account_id FROM posts").social_account_id, "chosen");
  assert.equal(w.row("SELECT campaign_id FROM generation_jobs").campaign_id, null);
});

test("campaign generation enforces the exact count and selected platform/account contracts", async (t) => {
  const w = await ready(t);
  w.env.X_CLIENT_ID = "fixture-x";
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,access_token_ciphertext) VALUES('x-account','client-a','x','x-id','connected',?)",
    await encryptSecret("fixture-x", w.env),
  );
  let schema;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    schema = JSON.parse(init.body).text.format.schema;
    return Response.json({
      output_text: JSON.stringify({
        campaignName: "Chosen campaign",
        summary: "Summary",
        posts: [post(), post("x"), post(), post("x")],
      }),
    });
  });
  const response = await send(w, "/v1/creation-jobs", {
    ...request,
    mode: "campaign",
    outputCount: 4,
    destinationIds: ["chosen", "x-account"],
  });
  assert.equal(response.status, 202);
  await runGenerationJob(w.env, (await response.json()).jobId);
  assert.equal(schema.properties.posts.minItems, 4);
  assert.equal(schema.properties.posts.maxItems, 4);
  assert.deepEqual(
    new Set(schema.properties.posts.items.properties.platform.enum),
    new Set(["facebook", "x"]),
  );
  assert.equal(w.row("SELECT COUNT(*) AS n FROM posts").n, 4);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM campaigns").n, 1);
  assert.equal(
    w.row("SELECT COUNT(*) AS n FROM posts WHERE platform='x' AND social_account_id='x-account'").n,
    2,
  );
});

test("a provider response outside the requested count or platforms cannot create partial posts", async (t) => {
  const w = await ready(t);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ output_text: JSON.stringify({ post: post("x") }) }),
  );
  const job = await (await send(w, "/v1/creation-jobs", request)).json();
  await assert.rejects(
    () => runGenerationJob(w.env, job.jobId),
    /requested count or chosen platforms/,
  );
  assert.equal(w.row("SELECT COUNT(*) AS n FROM posts").n, 0);
});

test("creation refuses foreign/unready accounts, missing brand/configuration, missing files and non-images", async (t) => {
  for (const mutate of [
    (w) => w.exec("UPDATE brand_profiles SET audience=''"),
    (w) => {
      w.env.OPENAI_API_KEY = "";
    },
    (w) => {
      w.env.META_APP_SECRET = "";
    },
    (w) => w.exec("UPDATE social_accounts SET status='reauth_required'"),
    (w) => w.exec("UPDATE social_accounts SET token_expires_at=1"),
    (w) => w.exec("UPDATE social_accounts SET client_id='client-b'"),
    (w) => w.objects.delete("source.jpg"),
    (w) => w.exec("UPDATE assets SET content_type='application/pdf'"),
  ]) {
    const w = await ready(t);
    mutate(w);
    const result = await send(w, "/v1/creation-jobs", request);
    assert.ok([400, 409].includes(result.status));
    assert.equal(w.row("SELECT COUNT(*) AS n FROM generation_jobs").n, 0);
  }
});

test("creation identity includes mode, count and destinations and survives readiness changing after acceptance", async (t) => {
  const w = await ready(t);
  const responses = await Promise.all([
    send(w, "/v1/creation-jobs", request),
    send(w, "/v1/creation-jobs", request),
  ]);
  const jobs = await Promise.all(responses.map((response) => response.json()));
  assert.equal(jobs[0].jobId, jobs[1].jobId);
  assert.equal(w.generated.length, 1);
  assert.equal(
    (await send(w, "/v1/creation-jobs", { ...request, mode: "campaign", outputCount: 3 })).status,
    409,
  );
  w.exec("UPDATE social_accounts SET status='disconnected'");
  assert.equal((await (await send(w, "/v1/creation-jobs", request)).json()).jobId, jobs[0].jobId);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM generation_jobs").n, 1);
});

test("invalid modes, counts and repeated platform selections are rejected", async (t) => {
  const w = await ready(t);
  for (const patch of [
    { mode: "other" },
    { mode: "social", outputCount: 3 },
    { mode: "campaign", outputCount: 2 },
    { outputCount: "1" },
    { destinationIds: [] },
    { destinationIds: ["chosen", "chosen"] },
  ])
    assert.equal((await send(w, "/v1/creation-jobs", { ...request, ...patch })).status, 400);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,access_token_ciphertext) SELECT 'other',client_id,platform,'other-page',status,access_token_ciphertext FROM social_accounts WHERE id='chosen'",
  );
  assert.equal(
    (
      await send(w, "/v1/creation-jobs", {
        ...request,
        mode: "campaign",
        outputCount: 3,
        destinationIds: ["chosen", "other"],
      })
    ).status,
    409,
  );
});

test("a chosen destination is never silently replaced by a different default account", async (t) => {
  const w = await ready(t);
  w.post("p");
  w.exec("UPDATE posts SET social_account_id='chosen' WHERE id='p'");
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,is_default) VALUES('fallback','client-a','facebook','fallback','connected',1)",
  );
  w.exec("UPDATE social_accounts SET status='disconnected' WHERE id='chosen'");
  assert.equal(
    await ensurePostSocialDestination(w.env, {
      id: "p",
      client_id: "client-a",
      platform: "facebook",
      social_account_id: "chosen",
    }),
    null,
  );
  assert.equal(
    w.row("SELECT social_account_id FROM posts WHERE id='p'").social_account_id,
    "chosen",
  );
});

test("default selection is atomic, client/platform scoped and permission checked", async (t) => {
  const w = await ready(t);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status) VALUES('other','client-a','facebook','other','connected'),('foreign','client-b','facebook','foreign','connected')",
  );
  assert.equal((await send(w, "/v1/social/accounts/chosen/default", {}, "viewer")).status, 403);
  await Promise.all([
    send(w, "/v1/social/accounts/chosen/default"),
    send(w, "/v1/social/accounts/other/default"),
  ]);
  assert.equal(
    w.row("SELECT COUNT(*) AS n FROM social_accounts WHERE client_id='client-a' AND is_default=1")
      .n,
    1,
  );
  assert.equal(w.row("SELECT is_default FROM social_accounts WHERE id='foreign'").is_default, 0);
  w.exec("UPDATE social_accounts SET status='disconnected' WHERE id='chosen'");
  assert.equal((await send(w, "/v1/social/accounts/chosen/default")).status, 409);
});

function campaign(w, status = "active") {
  w.exec(
    "INSERT INTO campaigns(id,client_id,name,status) VALUES('campaign','client-a','Campaign',?)",
    status,
  );
  w.exec("UPDATE clients SET timezone='UTC' WHERE id='client-a'");
  w.exec("UPDATE workspace_settings SET preferred_windows='[]'");
}
function campaignPost(w, id = "p", status = "awaiting_approval") {
  w.post(id, "client-a", status);
  w.exec(
    "UPDATE posts SET campaign_id='campaign',graphic_key='graphic.jpg',social_account_id='chosen',suggested_publish_at='2030-01-01T09:00:00Z' WHERE id=?",
    id,
  );
}

test("campaign start/end constrain reservation and inactive campaigns cannot schedule", async (t) => {
  const w = await ready(t);
  campaign(w);
  campaignPost(w);
  w.exec("UPDATE campaigns SET starts_at='2030-01-05',ends_at='2030-01-05'");
  const input = {
    clientId: "client-a",
    status: "awaiting_approval",
    publishVersion: 1,
    desiredAt: "2030-01-01T09:00:00Z",
    decision: "approved",
  };
  const time = await reserveSchedule(w.env, "p", input);
  assert.equal(time, "2030-01-05T00:00:00.000Z");
  campaignPost(w, "late");
  assert.equal(
    await reserveSchedule(w.env, "late", { ...input, desiredAt: "2030-01-06T00:00:00Z" }),
    null,
  );
  w.exec("UPDATE campaigns SET status='paused'");
  campaignPost(w, "paused");
  assert.equal(await reserveSchedule(w.env, "paused", input), null);
});

test("campaign pause after publisher reads its state defeats the claim", async (t) => {
  const w = await ready(t);
  campaign(w);
  campaignPost(w, "p", "calendar_scheduled");
  w.exec("UPDATE posts SET prepublish_response='publish_now'");
  const job = await ensurePublishJob(w.env, "p");
  const prepare = w.env.DB.prepare;
  w.env.DB.prepare = (sql) => {
    const wrap = (statement) => {
      const bind = statement.bind;
      statement.bind = (...args) => wrap(bind(...args));
      if (sql.includes("SELECT c.id,c.status,c.starts_at")) {
        const first = statement.first;
        statement.first = async () => {
          const row = await first.call(statement);
          w.exec("UPDATE campaigns SET status='paused',workflow_revision=workflow_revision+1");
          return row;
        };
      }
      return statement;
    };
    return wrap(prepare(sql));
  };
  assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, false);
});

test("campaign bulk actions report skips and preserve published and active publishing work", async (t) => {
  const w = await ready(t);
  campaign(w);
  campaignPost(w, "review");
  campaignPost(w, "live", "published");
  let result = await send(w, "/v1/campaigns/campaign/posts/approve");
  assert.equal(result.status, 200);
  let data = await result.json();
  assert.equal(data.results.find((p) => p.postId === "review").ok, true);
  assert.equal(data.results.find((p) => p.postId === "live").ok, false);
  assert.equal((await send(w, "/v1/campaigns/campaign/posts/pause", {}, "viewer")).status, 403);
  assert.equal((await send(w, "/v1/campaigns/campaign/posts/pause")).status, 200);
  assert.equal(w.row("SELECT status FROM posts WHERE id='review'").status, "paused");
  const resumed = await (await send(w, "/v1/campaigns/campaign/posts/resume")).json();
  assert.equal(
    w.row("SELECT status FROM posts WHERE id='review'").status,
    "calendar_scheduled",
    JSON.stringify(resumed),
  );
  const job = await ensurePublishJob(w.env, "review");
  w.exec("UPDATE posts SET prepublish_response='publish_now' WHERE id='review'");
  assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, true);
  data = await (await send(w, "/v1/campaigns/campaign/posts/cancel")).json();
  assert.equal(data.results.find((p) => p.postId === "review").ok, false);
  assert.equal(w.row("SELECT status FROM posts WHERE id='live'").status, "published");
});

test("cron holds an inactive campaign even after a keep response and cannot enqueue it", async (t) => {
  const w = await ready(t);
  campaign(w, "paused");
  campaignPost(w, "p", "calendar_scheduled");
  w.exec(
    "UPDATE posts SET scheduled_publish_at='2000-01-01',prepublish_alert_at=CURRENT_TIMESTAMP,prepublish_response='keep'",
  );
  await worker.scheduled({}, w.env);
  assert.equal(w.row("SELECT status FROM posts WHERE id='p'").status, "paused");
  assert.equal(w.published.length, 0);
});

test("generation job lookup can retrieve an authorized job older than the latest fifty", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,created_at) VALUES('old','client-a','[]','2000-01-01')",
  );
  for (let i = 0; i < 51; i++)
    w.exec(
      "INSERT INTO generation_jobs(id,client_id,asset_ids) VALUES(?,'client-a','[]')",
      `new-${i}`,
    );
  assert.equal(
    (await (await w.request("/v1/generation-jobs", { user: "owner" })).json()).data.some(
      (job) => job.id === "old",
    ),
    false,
  );
  assert.equal(
    (await (await w.request("/v1/generation-jobs/old", { user: "owner" })).json()).data.id,
    "old",
  );
});

test("upload batches wait for every worker and retry failed derivatives without uploading originals again", async () => {
  const items = [0, 1, 2].map((index) => ({
    key: String(index),
    source: index,
    status: "pending",
  }));
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let settled = false;
  const first = uploadBatch(
    items,
    async (item, index) => {
      item.originalId = `original-${index}`;
      if (index === 0) throw Error("Derivative failed");
      if (index === 2) await gate;
    },
    () => {},
  ).catch(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  release();
  await first;
  assert.deepEqual(
    items.map((item) => item.status),
    ["failed", "ready", "ready"],
  );
  let retries = 0;
  await uploadBatch(
    items,
    async (item) => {
      retries++;
      assert.equal(item.originalId, "original-0");
    },
    () => {},
  );
  assert.equal(retries, 1);
  assert.ok(items.every((item) => item.status === "ready"));
});

test("publish controls expose only valid state-dependent actions", () => {
  const base = {
    approvedAt: "2030-01-01",
    scheduledPublishAt: "2030-01-02",
    socialAccountId: "account",
  };
  for (const status of [
    "published",
    "publishing",
    "publish_queued",
    "provider_processing",
    "failed",
    "awaiting_approval",
    "canceled",
  ]) {
    const actions = publishActions({ ...base, status });
    assert.equal(actions.publish, false);
    assert.equal(actions.keep, false);
    assert.equal(actions.reschedule, false);
  }
  assert.equal(publishActions({ ...base, status: "paused" }).resume, true);
  assert.equal(publishActions({ ...base, status: "paused" }).keep, false);
  assert.equal(
    publishActions({ ...base, status: "calendar_scheduled", publishBlockReason: "Campaign paused" })
      .publish,
    false,
  );
  assert.equal(publishActions({ ...base, status: "calendar_scheduled" }).publish, true);
});

test("invalid generated output is not cached and a retry can generate valid content", async (t) => {
  const w = await ready(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      output_text: JSON.stringify({ post: post(++calls === 1 ? "x" : "facebook") }),
    }),
  );
  const job = await (await send(w, "/v1/creation-jobs", request)).json();
  await assert.rejects(() => runGenerationJob(w.env, job.jobId), /requested count/);
  assert.equal(w.row("SELECT plan_json FROM generation_jobs").plan_json, null);
  await runGenerationJob(w.env, job.jobId);
  assert.equal(calls, 2);
  assert.equal(w.row("SELECT COUNT(*) AS n FROM posts").n, 1);
});

test("campaign dates validate real days and use client-local inclusive end dates across DST", async (t) => {
  const w = await ready(t);
  campaign(w);
  assert.equal((await send(w, "/v1/campaigns/campaign", { startsAt: "2030-02-31" })).status, 400);
  assert.equal((await send(w, "/v1/campaigns/campaign", { endsAt: 2030 })).status, 400);
  assert.equal(
    (await send(w, "/v1/campaigns/campaign", { startsAt: "2030-01-03", endsAt: "2030-01-02" }))
      .status,
    400,
  );
  assert.equal(
    campaignBoundary("2030-03-10", "America/Indiana/Indianapolis", true) -
      campaignBoundary("2030-03-10", "America/Indiana/Indianapolis"),
    23 * 3600000,
  );
});

test("creation readiness reports a missing selected brand logo before spending on generation", async (t) => {
  const w = await ready(t);
  w.exec("UPDATE brand_profiles SET logo_asset_id='source'");
  w.objects.delete("source.jpg");
  const response = await w.request("/v1/clients/client-a/creation-readiness", { user: "owner" });
  assert.match((await response.json()).data.blockers.join(" "), /brand logo is missing/);
});

test("campaign priority orders work without changing calendar spacing", async (t) => {
  const w = await ready(t);
  campaign(w);
  w.exec(
    "INSERT INTO campaigns(id,client_id,name,priority) VALUES('high','client-a','High priority',100)",
  );
  const rows = (
    await (await w.request("/v1/campaigns?clientId=client-a", { user: "owner" })).json()
  ).data;
  assert.equal(rows[0].id, "high");
  assert.equal(
    w.row("SELECT min_post_spacing_minutes FROM workspace_settings").min_post_spacing_minutes,
    180,
  );
});

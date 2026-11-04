import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import { claimPublishJob, ensurePublishJob } from "../cloudflare/src/publishing.ts";

const remove = (w, extra = {}) =>
  w.request("/v1/clients/client-a", {
    user: "owner",
    method: "DELETE",
    body: { confirmName: "Client A" },
    ...extra,
  });

test("client removal hides the workspace, fences work, clears credentials and retains an audit trail", async (t) => {
  const w = workspace(t);
  w.post("queued", "client-a", "calendar_scheduled");
  const job = await ensurePublishJob(w.env, "queued");
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,account_name,external_account_id,status,access_token_ciphertext,refresh_token_ciphertext) VALUES('social','client-a','facebook','Page','page','connected','secret','refresh')",
  );
  const result = await remove(w);
  assert.equal(result.status, 200, await result.text());
  assert.equal(w.row("SELECT status FROM clients WHERE id='client-a'").status, "removed");
  assert.equal(w.row("SELECT status FROM posts WHERE id='queued'").status, "canceled");
  assert.equal(w.row("SELECT status FROM publish_jobs WHERE id=?", job.jobId).status, "canceled");
  assert.equal(
    w.row("SELECT access_token_ciphertext FROM social_accounts WHERE id='social'")
      .access_token_ciphertext,
    null,
  );
  assert.equal(
    w.row("SELECT COUNT(*) AS n FROM recovery_actions WHERE action='remove_client'").n,
    1,
  );
  for (const path of ["/v1/clients", "/v1/clients?includeArchived=1"]) {
    const data = await (await w.request(path, { user: "owner" })).json();
    assert.ok(!data.data.some((c) => c.id === "client-a"));
    assert.ok(data.data.some((c) => c.id === "client-b"));
  }
  assert.equal(
    (await w.request("/v1/clients/client-a/restore", { user: "owner", method: "POST" })).status,
    403,
  );
  assert.equal((await w.request("/v1/posts/queued", { user: "owner" })).status, 403);
  assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, false);
});

test("removal requires client management permission and current client confirmation", async (t) => {
  const w = workspace(t);
  assert.equal((await remove(w, { user: undefined })).status, 401);
  assert.equal((await remove(w, { user: "viewer" })).status, 403);
  assert.equal((await remove(w, { body: { confirmName: "Stale name" } })).status, 409);
  assert.equal(w.row("SELECT status FROM clients WHERE id='client-a'").status, "active");
});

for (const status of ["publishing", "provider_processing", "regenerating"])
  test(`removal preserves a client with ${status} work`, async (t) => {
    const w = workspace(t);
    w.post("running", "client-a", status);
    assert.equal((await remove(w)).status, 409);
    assert.equal(w.row("SELECT status FROM posts WHERE id='running'").status, status);
    assert.equal(w.row("SELECT status FROM clients WHERE id='client-a'").status, "active");
  });

test("a publisher claiming after removal reads the client blocks every removal side effect", async (t) => {
  const w = workspace(t);
  w.post("racing", "client-a", "calendar_scheduled");
  const job = await ensurePublishJob(w.env, "racing");
  const batch = w.env.DB.batch.bind(w.env.DB);
  t.mock.method(w.env.DB, "batch", async (statements) => {
    assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, true);
    return batch(statements);
  });
  assert.equal((await remove(w)).status, 409);
  assert.equal(w.row("SELECT status FROM clients WHERE id='client-a'").status, "active");
  assert.equal(w.row("SELECT status FROM publish_jobs WHERE id=?", job.jobId).status, "publishing");
  assert.equal(
    w.row("SELECT COUNT(*) AS n FROM recovery_actions WHERE action='remove_client'").n,
    0,
  );
});

test("unknown publishing outcomes require reconciliation before client removal", async (t) => {
  const w = workspace(t);
  w.post("uncertain", "client-a", "failed");
  w.exec("UPDATE posts SET failure_code='PUBLISH_OUTCOME_UNKNOWN' WHERE id='uncertain'");
  assert.equal((await remove(w)).status, 409);
  assert.equal(w.row("SELECT status FROM clients WHERE id='client-a'").status, "active");
});

test("removed client history is excluded from owner workspace summaries and account listings", async (t) => {
  const w = workspace(t);
  w.post("published-history", "client-a", "published");
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,account_name,external_account_id,status) VALUES('retained','client-a','facebook','Historical page','history','connected')",
  );
  assert.equal((await remove(w)).status, 200);
  const dashboard = await (await w.request("/v1/dashboard", { user: "owner" })).json();
  assert.equal(dashboard.data.activeClients, 1);
  const accounts = await (await w.request("/v1/social/accounts", { user: "owner" })).json();
  assert.ok(!accounts.data.some((account) => account.client_id === "client-a"));
  assert.equal(w.row("SELECT status FROM posts WHERE id='published-history'").status, "published");
});

test("an owner suspended after the removal preflight cannot mutate any client data", async (t) => {
  const w = workspace(t),
    batch = w.env.DB.batch.bind(w.env.DB);
  t.mock.method(w.env.DB, "batch", async (statements) => {
    w.exec("UPDATE users SET status='suspended' WHERE id='owner'");
    return batch(statements);
  });
  assert.equal((await remove(w)).status, 409);
  assert.equal(w.row("SELECT status FROM clients WHERE id='client-a'").status, "active");
  assert.equal(
    w.row("SELECT COUNT(*) AS n FROM recovery_actions WHERE action='remove_client'").n,
    0,
  );
});

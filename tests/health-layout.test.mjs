import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";

test("shared health scopes sync runs to authorized clients, including explicit filters", async (t) => {
  const w = workspace(t);
  for (const [id, client] of [
    ["account-a", "client-a"],
    ["account-b", "client-b"],
  ]) {
    w.exec(
      "INSERT INTO social_accounts(id,client_id,platform,account_name,status) VALUES (?,?,'facebook',?,'connected')",
      id,
      client,
      id,
    );
    w.exec(
      "INSERT INTO analytics_sync_runs(id,social_account_id,status,error_message) VALUES (?,?,'failed',?)",
      id,
      id,
      `Private ${id} error`,
    );
  }
  const get = async (path, user = "viewer") => {
    const response = await w.request(path, { user });
    return { status: response.status, body: await response.json() };
  };
  const assigned = await get("/v1/analytics/health");
  assert.equal(assigned.status, 200);
  assert.deepEqual(
    assigned.body.data.map((r) => r.client_id),
    ["client-a"],
  );
  assert.equal((await get("/v1/analytics/health?clientId=client-b")).status, 403);
  assert.equal((await get("/v1/analytics/health", "owner")).body.data.length, 2);
  assert.equal(
    (await get("/v1/analytics/health?clientId=client-b", "owner")).body.data[0].account_name,
    "account-b",
  );
  assert.equal((await w.request("/v1/system/overview", { user: "viewer" })).status, 403);
  assert.equal((await w.request("/v1/analytics/health")).status, 401);
  w.exec("DELETE FROM user_client_access WHERE user_id='viewer'");
  assert.deepEqual((await get("/v1/analytics/health")).body.data, []);
  w.exec("UPDATE clients SET status='removed' WHERE id='client-b'");
  assert.equal((await get("/v1/analytics/health", "owner")).body.data.length, 1);
});

test("shared health returns a bounded newest-first history", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,status) VALUES ('account','client-a','facebook','connected')",
  );
  for (let index = 0; index < 60; index++)
    w.exec(
      "INSERT INTO analytics_sync_runs(id,social_account_id,status) VALUES (?,'account','completed')",
      `run-${index}`,
    );
  const result = await (await w.request("/v1/analytics/health", { user: "owner" })).json();
  assert.equal(result.data.length, 50);
  assert.equal(result.data[0].id, "run-59");
});

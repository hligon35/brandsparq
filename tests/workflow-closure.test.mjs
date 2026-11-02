import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import { enqueueAnalytics } from "../cloudflare/src/analytics-jobs.ts";
import { socialOAuthStart, socialOAuthCallback } from "../cloudflare/src/social.ts";

test("requested changes remain reachable in the main review queue", async (t) => {
  const w = workspace(t);
  w.post("changes");
  const rejected = await w.request("/v1/posts/changes/reject", {
    user: "owner",
    method: "POST",
    body: { reason: "Fix headline" },
  });
  assert.equal(rejected.status, 200);
  const queue = await (await w.request("/v1/posts/review", { user: "owner" })).json();
  assert.equal(queue.data.length, 1);
  assert.equal(queue.data[0].status, "edit_requested");
  assert.equal(
    (await (await w.request("/v1/posts/review", { user: "viewer" })).json()).data.length,
    1,
  );
});

test("analytics mismatched range is actionable and equal range coalesces", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,status) VALUES('a','client-a','facebook','connected')",
  );
  const first = await enqueueAnalytics(w.env, "a", 7);
  await assert.rejects(enqueueAnalytics(w.env, "a", 90), /7-day.*90 days/);
  assert.equal((await enqueueAnalytics(w.env, "a", 7)).id, first.id);
  await assert.rejects(enqueueAnalytics(w.env, "a", 0), /between 1 and 365/);
});

test("Meta import preflights archived assignments before writing any clients", async (t) => {
  const w = workspace(t);
  w.env.META_APP_ID = "app";
  w.env.META_APP_SECRET = "secret";
  w.exec("UPDATE clients SET status='archived' WHERE id='client-b'");
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status) VALUES('existing','client-b','facebook','page-2','disconnected')",
  );
  t.mock.method(globalThis, "fetch", async (input) =>
    new URL(input).pathname.endsWith("/oauth/access_token")
      ? Response.json({ access_token: "token" })
      : Response.json({
          data: [
            { id: "page-1", name: "First", access_token: "p1" },
            { id: "page-2", name: "Second", access_token: "p2" },
          ],
        }),
  );
  const start = new URL(
    await socialOAuthStart(
      w.env,
      new URL(w.env.PUBLIC_BASE_URL),
      "facebook",
      "",
      "owner",
      w.env.PUBLIC_BASE_URL + "/social",
      true,
    ),
  );
  await assert.rejects(
    socialOAuthCallback(
      w.env,
      new URL(
        w.env.PUBLIC_BASE_URL +
          "/v1/social/meta/callback?code=code&state=" +
          start.searchParams.get("state"),
      ),
      "meta",
    ),
    /archived client/,
  );
  assert.equal(w.row("SELECT COUNT(*) n FROM clients WHERE name='First'").n, 0);
  assert.equal(
    w.row("SELECT COUNT(*) n FROM social_accounts WHERE external_account_id='page-1'").n,
    0,
  );
});

test("Meta reports partial persistence with a recoverable client link", async (t) => {
  const w = workspace(t);
  w.env.META_APP_ID = "app";
  w.env.META_APP_SECRET = "secret";
  w.exec(
    "CREATE TRIGGER fail_second_import BEFORE INSERT ON social_accounts WHEN NEW.external_account_id='page-2' BEGIN SELECT RAISE(ABORT,'fixture write failure'); END",
  );
  t.mock.method(globalThis, "fetch", async (input) =>
    new URL(input).pathname.endsWith("/oauth/access_token")
      ? Response.json({ access_token: "token" })
      : Response.json({
          data: [
            { id: "page-1", name: "First", access_token: "p1" },
            { id: "page-2", name: "Second", access_token: "p2" },
          ],
        }),
  );
  const start = new URL(
    await socialOAuthStart(
      w.env,
      new URL(w.env.PUBLIC_BASE_URL),
      "facebook",
      "",
      "owner",
      w.env.PUBLIC_BASE_URL + "/social",
      true,
    ),
  );
  const result = new URL(
    await socialOAuthCallback(
      w.env,
      new URL(
        w.env.PUBLIC_BASE_URL +
          "/v1/social/meta/callback?code=code&state=" +
          start.searchParams.get("state"),
      ),
      "meta",
    ),
  );
  assert.match(result.searchParams.get("social_error"), /1 accounts connected across 1 clients/);
  assert.ok(result.searchParams.get("clientId"));
  assert.equal(result.searchParams.has("social_connected"), false);
  assert.equal(w.row("SELECT COUNT(*) n FROM clients WHERE name='Second'").n, 0);
});

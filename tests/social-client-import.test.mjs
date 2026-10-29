import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { workspace } from "./workspace.mjs";
import { socialOAuthStart, socialOAuthCallback } from "../cloudflare/src/social.ts";
import { decryptSecret, encryptSecret } from "../cloudflare/src/security.ts";

function setup(t, data = []) {
  const w = workspace(t);
  w.env.META_APP_ID = "test-app";
  w.env.META_APP_SECRET = "test-secret";
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.pathname.endsWith("/oauth/access_token"))
      return Response.json({ access_token: "user-token" });
    return Response.json(typeof data === "function" ? data(url) : { data });
  });
  const start = async (importing = true, client = "", user = "owner") => {
    const url = new URL(
      await socialOAuthStart(
        w.env,
        new URL(w.env.PUBLIC_BASE_URL),
        "instagram",
        client,
        user,
        `${w.env.PUBLIC_BASE_URL}/social`,
        importing,
      ),
    );
    return new URL(
      `${w.env.PUBLIC_BASE_URL}/v1/social/meta/callback?code=accepted&state=${url.searchParams.get("state")}`,
    );
  };
  return {
    w,
    calls,
    start,
    connect: async (importing = true, client = "") =>
      socialOAuthCallback(w.env, await start(importing, client), "meta"),
  };
}
const page = (id, name = id) => ({
  id,
  name,
  access_token: `${id}-token`,
  instagram_business_account: { id: `${id}-ig`, username: `${name}-ig` },
});

test("Meta import creates separate clients for each Page with its linked Instagram and refreshes callback selection", async (t) => {
  const { w, connect } = setup(t, [page("one", "First business"), page("two", "Second business")]);
  w.exec("UPDATE workspace_settings SET timezone='Pacific/Auckland' WHERE id='default'");
  const destination = new URL(await connect());
  assert.equal(destination.searchParams.get("connected_clients"), "2");
  assert.equal(destination.searchParams.get("connected_accounts"), "4");
  const clients = w.sqlite.prepare("SELECT DISTINCT client_id FROM social_accounts").all();
  assert.equal(clients.length, 2);
  assert.ok(clients.some((c) => c.client_id === destination.searchParams.get("clientId")));
  for (const { client_id } of clients) {
    const accounts = w.sqlite
      .prepare("SELECT * FROM social_accounts WHERE client_id=?")
      .all(client_id);
    assert.equal(accounts.length, 2);
    assert.deepEqual(accounts.map((a) => a.platform).sort(), ["facebook", "instagram"]);
    for (const account of accounts) {
      assert.equal(account.status, "connected");
      assert.equal(account.health_status, "healthy");
      assert.ok(account.is_default);
      assert.ok(await decryptSecret(account.access_token_ciphertext, w.env));
      assert.notEqual(account.access_token_ciphertext, "one-token");
    }
    assert.equal(
      w.row("SELECT timezone FROM clients WHERE id=?", client_id).timezone,
      "Pacific/Auckland",
    );
    assert.equal(w.row("SELECT COUNT(*) n FROM brand_profiles WHERE client_id=?", client_id).n, 1);
  }
});

test("Meta import follows discovery cursors and reconnects without duplicating clients or accounts", async (t) => {
  const { w, connect, calls } = setup(t, (url) =>
    url.searchParams.has("after")
      ? { data: [page("two")] }
      : {
          data: [page("one")],
          paging: { next: "https://graph.facebook.com/next", cursors: { after: "next-page" } },
        },
  );
  await connect();
  await connect();
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 4);
  assert.equal(w.row("SELECT COUNT(*) n FROM social_accounts").n, 4);
  assert.equal(calls.filter((url) => url.searchParams.get("after") === "next-page").length, 2);
});

test("empty discovery returns an actionable error without false success or creating clients", async (t) => {
  const { w, connect } = setup(t);
  const url = new URL(await connect());
  assert.match(url.searchParams.get("social_error"), /no Facebook Pages/);
  assert.equal(url.searchParams.has("social_connected"), false);
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 2);
});

test("Facebook-only discovery does not claim an Instagram connection", async (t) => {
  const { w, connect } = setup(t, [
    { id: "page-only", name: "Page only", access_token: "page-token" },
  ]);
  const url = new URL(await connect());
  assert.equal(url.searchParams.get("instagram_accounts"), "0");
  assert.equal(url.searchParams.get("connected_accounts"), "1");
  assert.equal(w.row("SELECT COUNT(*) n FROM social_accounts WHERE platform='instagram'").n, 0);
});

test("discovery can begin before any client exists and imports only after authorization", async (t) => {
  const { w, start } = setup(t, [page("new")]);
  w.exec("DELETE FROM user_client_access");
  w.exec("DELETE FROM clients");
  const callback = await start();
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 0);
  await socialOAuthCallback(w.env, callback, "meta");
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 1);
});

test("import reuses a manually created client already connected to either account ID", async (t) => {
  const { w, connect } = setup(t, [page("existing")]);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,access_token_ciphertext) VALUES('old','client-a','instagram','existing-ig','connected',?)",
    await encryptSecret("old", w.env),
  );
  const url = new URL(await connect());
  assert.equal(url.searchParams.get("clientId"), "client-a");
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 2);
  assert.equal(w.row("SELECT COUNT(*) n FROM social_accounts WHERE client_id='client-a'").n, 2);
});

test("existing-client mode still attaches detected accounts to the explicitly selected client", async (t) => {
  const { w, connect } = setup(t, [page("existing")]);
  const url = new URL(await connect(false, "client-b"));
  assert.equal(url.searchParams.get("clientId"), "client-b");
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 2);
  assert.equal(w.row("SELECT COUNT(*) n FROM social_accounts WHERE client_id='client-b'").n, 2);
});

test("non-owners cannot import and a revoked owner cannot create clients after the provider exchange", async (t) => {
  const { w, start } = setup(t, [page("new")]);
  await assert.rejects(start(true, "", "viewer"), /workspace owner/);
  const callback = await start();
  w.exec("UPDATE users SET role='viewer' WHERE id='owner'");
  await assert.rejects(socialOAuthCallback(w.env, callback, "meta"), /revoked/);
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 2);
});

test("disconnect during discovery fences import reconnection", async (t) => {
  const { w, connect, start } = setup(t, [page("existing")]);
  await connect();
  const callback = await start();
  w.exec(
    "UPDATE social_accounts SET status='disconnected',connection_revision=connection_revision+1",
  );
  await assert.rejects(socialOAuthCallback(w.env, callback, "meta"), /connection changed/);
  assert.equal(w.row("SELECT COUNT(*) n FROM social_accounts WHERE status='connected'").n, 0);
});

test("ambiguous existing client assignments are not merged or reassigned", async (t) => {
  const { w, connect } = setup(t, [page("existing")]);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status) VALUES('fb','client-a','facebook','existing','connected'),('ig','client-b','instagram','existing-ig','connected')",
  );
  await assert.rejects(connect(), /multiple clients/);
  assert.equal(w.row("SELECT client_id FROM social_accounts WHERE id='fb'").client_id, "client-a");
  assert.equal(w.row("SELECT client_id FROM social_accounts WHERE id='ig'").client_id, "client-b");
});

test("replayed and wrong-provider callbacks cannot create clients", async (t) => {
  const { w, start, connect } = setup(t, [page("new")]);
  const callback = await start();
  await assert.rejects(socialOAuthCallback(w.env, callback, "x"), /provider/);
  await assert.rejects(socialOAuthCallback(w.env, callback, "meta"), /invalid or expired/);
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 2);
  await connect();
});

test("authenticated import API accepts no client and rejects non-owner import", async (t) => {
  const { w } = setup(t);
  const body = {
    platform: "instagram",
    importClients: true,
    returnTo: `${w.env.PUBLIC_BASE_URL}/social`,
  };
  assert.equal((await w.request("/v1/social/connect", { method: "POST", body })).status, 401);
  assert.equal(
    (await w.request("/v1/social/connect", { method: "POST", body, user: "viewer" })).status,
    403,
  );
  const result = await w.request("/v1/social/connect", { method: "POST", body, user: "owner" });
  assert.equal(result.status, 200);
  assert.ok(new URL((await result.json()).authorizationUrl).searchParams.get("state"));
  assert.equal(w.row("SELECT import_clients FROM social_oauth_states").import_clients, 1);
  assert.equal(w.row("SELECT client_id FROM social_oauth_states").client_id, null);
});

test("role revocation during provider exchange cannot create orphan clients", async (t) => {
  const { w, start } = setup(t, [page("new")]);
  const callback = await start();
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input) => {
    if (new URL(input).pathname.endsWith("/oauth/access_token"))
      w.exec("UPDATE users SET role='viewer' WHERE id='owner'");
    return fetch(input);
  });
  await assert.rejects(socialOAuthCallback(w.env, callback, "meta"), /connection changed/);
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 2);
  assert.equal(w.row("SELECT COUNT(*) n FROM brand_profiles").n, 0);
});

test("failed account persistence rolls back the new client and brand profile", async (t) => {
  const { w, connect } = setup(t, [page("new")]);
  w.exec(
    "CREATE TRIGGER fail_import BEFORE INSERT ON social_accounts BEGIN SELECT RAISE(ABORT,'fixture write failure'); END",
  );
  await assert.rejects(connect(), /fixture write failure/);
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 2);
  assert.equal(w.row("SELECT COUNT(*) n FROM brand_profiles").n, 0);
});

test("invalid pagination never saves a partial list or claims success", async (t) => {
  const { w, connect } = setup(t, {});
  t.mock.method(globalThis, "fetch", async (input) =>
    new URL(input).pathname.endsWith("/oauth/access_token")
      ? Response.json({ access_token: "token" })
      : Response.json({ data: [page("new")], paging: { next: "https://graph.facebook.com/next" } }),
  );
  await assert.rejects(connect(), /discovery could not finish/);
  assert.equal(w.row("SELECT COUNT(*) n FROM clients").n, 2);
});

test("the import migration preserves pending OAuth states and their revision fences", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const dir = new URL("../cloudflare/migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".sql") && name < "0029")
    .sort())
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  db.exec(`INSERT INTO users(id,email) VALUES('operator','operator@example.test');
    INSERT INTO clients(id,name) VALUES('business','Business');
    INSERT INTO social_oauth_states(id,platform,client_id,user_id,state_hash,return_to,expires_at,created_at,connection_revisions)
    VALUES('pending','meta','business','operator','hash','https://example.test/social',9999999999999,1,'{"account":7}');`);
  db.exec(readFileSync(new URL("0029_social_client_import.sql", dir), "utf8"));
  const state = db.prepare("SELECT * FROM social_oauth_states WHERE id='pending'").get();
  assert.equal(state.client_id, "business");
  assert.equal(state.user_id, "operator");
  assert.equal(state.connection_revisions, '{"account":7}');
  assert.equal(state.import_clients, 0);
  assert.equal(state.consumed_at, null);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { workspace, digest } from "./workspace.mjs";
import { encryptSecret, decryptSecret } from "../cloudflare/src/security.ts";
import {
  verifySocialAccount,
  SocialConnectionChanged,
  socialOAuthStart,
  socialOAuthCallback,
} from "../cloudflare/src/social.ts";
import { runLaunchCertification } from "../cloudflare/src/operations.ts";
const check = (name, fn) => test(name, { timeout: 5000 }, fn);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const send = (w, path, body) => w.request(path, { user: "owner", method: "POST", body });
const brandRevision = (w) => w.row("SELECT edit_revision n FROM clients WHERE id='client-a'").n;
const postRevision = (w, id = "post") =>
  w.row("SELECT content_revision n FROM posts WHERE id=?", id).n;
async function account(w, id = "first", platform = "facebook", expires = null) {
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,health_status,access_token_ciphertext,refresh_token_ciphertext,token_expires_at) VALUES (?,'client-a',?,?,'connected','healthy',?,?,?)",
    id,
    platform,
    id,
    await encryptSecret("access", w.env),
    await encryptSecret("refresh", w.env),
    expires,
  );
}
function asset(w, id = "logo", client = "client-a") {
  w.exec(
    "INSERT INTO assets(id,client_id,r2_key,filename,content_type) VALUES (?,?,?,?,'image/png')",
    id,
    client,
    id,
    id,
  );
  w.objects.set(id, "logo bytes");
}
async function loadedBrand(w) {
  return (await (await w.request("/v1/clients/client-a/brand", { user: "owner" })).json()).data;
}
// Hold immediately before a real D1 write, leaving other requests free to win.
function holdWrite(w, match) {
  const started = deferred(),
    release = deferred();
  const prepare = w.env.DB.prepare;
  let held = false;
  w.env.DB.prepare = (sql) => {
    const wrap = (s) => ({
      ...s,
      bind(...a) {
        return wrap(s.bind(...a));
      },
      async run() {
        if (!held && match(sql)) {
          held = true;
          started.resolve();
          await release.promise;
        }
        return s.run();
      },
    });
    return wrap(prepare(sql));
  };
  return { started, release };
}
check(
  "brand saves preserve omitted logo selections and atomically save client identity",
  async (t) => {
    const w = workspace(t);
    asset(w);
    asset(w, "alternate");
    w.exec(
      "INSERT INTO brand_profiles(id,client_id,voice,logo_asset_id,alternate_logo_asset_id) VALUES ('brand','client-a','Original','logo','alternate')",
    );
    const snapshot = await loadedBrand(w);
    const r = await send(w, "/v1/clients/client-a/brand", {
      expectedRevision: snapshot.revision,
      voice: "Updated",
      primaryColor: "#123456",
      name: "Renamed",
      timezone: "UTC",
    });
    assert.equal(r.status, 200);
    const saved = (await r.json()).data;
    assert.equal(saved.logo_asset_id, "logo");
    assert.equal(saved.alternate_logo_asset_id, "alternate");
    assert.equal(saved.name, "Renamed");
    assert.equal(saved.timezone, "UTC");
    assert.equal(saved.voice, "Updated");
    const removed = await send(w, "/v1/clients/client-a/brand", {
      expectedRevision: saved.revision,
      logoAssetId: null,
    });
    assert.equal(removed.status, 200);
    assert.equal((await loadedBrand(w)).logo_asset_id, null);
    assert.equal((await loadedBrand(w)).alternate_logo_asset_id, "alternate");
  },
);
check("brand transaction rolls back client identity when profile persistence fails", async (t) => {
  const w = workspace(t);
  w.exec(
    "CREATE TRIGGER reject_brand BEFORE INSERT ON brand_profiles BEGIN SELECT RAISE(ABORT,'fixture write failure'); END",
  );
  assert.equal(
    (
      await send(w, "/v1/clients/client-a/brand", {
        expectedRevision: 0,
        name: "Must roll back",
        voice: "New",
      })
    ).status,
    500,
  );
  assert.equal(w.row("SELECT name FROM clients WHERE id='client-a'").name, "Client A");
  assert.equal(brandRevision(w), 0);
});
check(
  "first logo attachment repairs a missing profile and stale attachments/removals fail",
  async (t) => {
    const w = workspace(t);
    asset(w);
    const first = await send(w, "/v1/clients/client-a/brand-assets", {
      assetId: "logo",
      role: "logo",
      expectedRevision: 0,
    });
    assert.equal(first.status, 200);
    const attached = await first.json();
    assert.equal(attached.revision, brandRevision(w));
    assert.equal((await loadedBrand(w)).logo_asset_id, "logo");
    assert.equal(
      (
        await send(w, "/v1/clients/client-a/brand-assets", {
          assetId: "logo",
          role: "alternate_logo",
          expectedRevision: 0,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await send(w, `/v1/clients/client-a/brand-assets/${attached.id}/remove`, {
          expectedRevision: 0,
        })
      ).status,
      409,
    );
    assert.equal((await loadedBrand(w)).logo_asset_id, "logo");
    const removed = await send(w, `/v1/clients/client-a/brand-assets/${attached.id}/remove`, {
      expectedRevision: attached.revision,
    });
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).revision, brandRevision(w));
    assert.equal((await loadedBrand(w)).logo_asset_id, null);
  },
);
check("stale Brand Brain and campaign forms cannot overwrite another editor", async (t) => {
  const w = workspace(t);
  const a = await loadedBrand(w);
  assert.equal(
    (
      await send(w, "/v1/clients/client-a/brand", {
        expectedRevision: a.revision,
        voice: "Editor B",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await send(w, "/v1/clients/client-a/brand", {
        expectedRevision: a.revision,
        voice: "Stale A",
        name: "Stale name",
      })
    ).status,
    409,
  );
  assert.equal((await loadedBrand(w)).voice, "Editor B");
  assert.equal((await loadedBrand(w)).name, "Client A");
  w.exec(
    "INSERT INTO campaigns(id,client_id,name,notes,status) VALUES ('campaign','client-a','Campaign','Original','active')",
  );
  const c = (await (await w.request("/v1/campaigns/campaign", { user: "owner" })).json()).data
    .campaign;
  assert.equal(
    (
      await send(w, "/v1/campaigns/campaign", {
        expectedRevision: c.workflow_revision,
        notes: "Editor B",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await send(w, "/v1/campaigns/campaign", {
        expectedRevision: c.workflow_revision,
        name: "Stale A",
        notes: c.notes,
      })
    ).status,
    409,
  );
  assert.equal(w.row("SELECT notes FROM campaigns WHERE id='campaign'").notes, "Editor B");
});
check("stale post copy and approval are rejected; saved revision is exact", async (t) => {
  const w = workspace(t);
  await account(w);
  w.post("post");
  w.exec("UPDATE posts SET social_account_id='first' WHERE id='post'");
  const a = postRevision(w);
  const b = await send(w, "/v1/posts/post/edit", { expectedRevision: a, caption: "Editor B" });
  assert.equal(b.status, 200);
  assert.equal((await b.json()).revision, a + 1);
  assert.equal(
    (
      await send(w, "/v1/posts/post/edit", {
        expectedRevision: a,
        caption: "Stale A",
        comment: "Must not persist",
      })
    ).status,
    409,
  );
  assert.equal(w.row("SELECT COUNT(*) n FROM review_comments").n, 0);
  assert.equal((await send(w, "/v1/posts/post/approve", { expectedRevision: a })).status, 409);
  assert.equal(w.row("SELECT caption FROM posts WHERE id='post'").caption, "Editor B");
  assert.equal((await send(w, "/v1/posts/post/approve", { expectedRevision: a + 1 })).status, 200);
});
check(
  "a late destination write loses to approval without changing approved destination",
  async (t) => {
    const w = workspace(t);
    await account(w);
    await account(w, "second");
    w.post("post");
    w.exec("UPDATE posts SET social_account_id='first' WHERE id='post'");
    const revision = postRevision(w);
    const held = holdWrite(w, (sql) => sql.startsWith("UPDATE posts SET social_account_id=?"));
    const pending = send(w, "/v1/posts/post/social-account", {
      socialAccountId: "second",
      expectedRevision: revision,
    });
    await held.started.promise;
    assert.equal(
      (await send(w, "/v1/posts/post/approve", { expectedRevision: revision })).status,
      200,
    );
    held.release.resolve();
    assert.equal((await pending).status, 409);
    assert.equal(
      w.row("SELECT social_account_id FROM posts WHERE id='post'").social_account_id,
      "first",
    );
  },
);
check("approval loses when a destination change wins during scheduling", async (t) => {
  const w = workspace(t);
  await account(w);
  await account(w, "second");
  w.post("post");
  w.exec("UPDATE posts SET social_account_id='first' WHERE id='post'");
  const revision = postRevision(w);
  const original = w.env.DB.batch,
    started = deferred(),
    release = deferred();
  let held = false;
  // Reserve's four/five-statement transaction is distinct from copy/brand writes.
  w.env.DB.batch = async (statements) => {
    if (!held && statements.length >= 4) {
      held = true;
      started.resolve();
      await release.promise;
    }
    return original(statements);
  };
  const pending = send(w, "/v1/posts/post/approve", { expectedRevision: revision });
  await started.promise;
  assert.equal(
    (
      await send(w, "/v1/posts/post/social-account", {
        socialAccountId: "second",
        expectedRevision: revision,
      })
    ).status,
    200,
  );
  release.resolve();
  assert.equal((await pending).status, 409);
  assert.equal(w.row("SELECT status FROM posts WHERE id='post'").status, "awaiting_approval");
  assert.equal(
    w.row("SELECT social_account_id FROM posts WHERE id='post'").social_account_id,
    "second",
  );
});
check("public and bulk approval reject changed content snapshots", async (t) => {
  const w = workspace(t);
  await account(w);
  w.post("post");
  w.exec("UPDATE posts SET social_account_id='first' WHERE id='post'");
  const a = postRevision(w);
  w.exec(
    "INSERT INTO review_tokens(id,post_id,recipient_email,token_hash,expires_at,created_at) VALUES ('review','post','reviewer@example.test',?,?,?)",
    digest(`${w.env.AUTH_PEPPER}:review:secret`),
    Date.now() + 60000,
    Date.now(),
  );
  assert.equal(
    (await send(w, "/v1/posts/post/edit", { expectedRevision: a, caption: "New copy" })).status,
    200,
  );
  assert.equal(
    (
      await w.request("/v1/public/review/secret/approve", {
        method: "POST",
        body: { expectedRevision: a },
      })
    ).status,
    409,
  );
  const bulk = await (
    await send(w, "/v1/posts/bulk/approve", { postIds: ["post"], expectedRevisions: { post: a } })
  ).json();
  assert.equal(bulk.results[0].ok, false);
  assert.equal(w.row("SELECT status FROM posts WHERE id='post'").status, "awaiting_approval");
});
for (const refresh of [false, true])
  check(
    `disconnect fences a late ${refresh ? "token refresh" : "verification"} response`,
    async (t) => {
      const w = workspace(t);
      await account(w, "first", refresh ? "x" : "facebook", refresh ? Date.now() + 1000 : null);
      const started = deferred(),
        release = deferred();
      t.mock.method(globalThis, "fetch", async (url) => {
        started.resolve();
        await release.promise;
        return String(url).includes("/oauth2/token")
          ? Response.json({ access_token: "late", refresh_token: "late refresh", expires_in: 3600 })
          : Response.json({ id: "first" });
      });
      const pending = verifySocialAccount(w.env, "first");
      const failure = assert.rejects(pending, SocialConnectionChanged);
      await started.promise;
      assert.equal((await send(w, "/v1/social/accounts/first/disconnect")).status, 200);
      release.resolve();
      await failure;
      const row = w.row(
        "SELECT status,access_token_ciphertext,refresh_token_ciphertext,refresh_claim FROM social_accounts WHERE id='first'",
      );
      assert.deepEqual(row, {
        status: "disconnected",
        access_token_ciphertext: null,
        refresh_token_ciphertext: null,
        refresh_claim: null,
      });
    },
  );
check("late failed verification cannot degrade a reconnected account", async (t) => {
  const w = workspace(t);
  await account(w);
  const started = deferred(),
    release = deferred();
  t.mock.method(globalThis, "fetch", async () => {
    started.resolve();
    await release.promise;
    return new Response("Old permission failure", { status: 401 });
  });
  const pending = verifySocialAccount(w.env, "first");
  const failure = assert.rejects(pending);
  await started.promise;
  w.exec(
    "UPDATE social_accounts SET connection_revision=connection_revision+1,access_token_ciphertext=?,status='connected',health_status='healthy' WHERE id='first'",
    await encryptSecret("new connection", w.env),
  );
  release.resolve();
  await failure;
  const row = w.row("SELECT status,health_status FROM social_accounts WHERE id='first'");
  assert.deepEqual(row, { status: "connected", health_status: "healthy" });
});
check(
  "concurrent refreshes make one provider request and do not degrade the connection",
  async (t) => {
    const w = workspace(t);
    await account(w, "first", "x", Date.now() + 1000);
    const started = deferred(),
      release = deferred();
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url) => {
      if (String(url).includes("/oauth2/token")) {
        calls++;
        started.resolve();
        await release.promise;
        return Response.json({
          access_token: "winner",
          refresh_token: "rotated",
          expires_in: 3600,
        });
      }
      return Response.json({ data: { id: "first" } });
    });
    const pending = verifySocialAccount(w.env, "first");
    await started.promise;
    await assert.rejects(verifySocialAccount(w.env, "first"), SocialConnectionChanged);
    assert.equal(calls, 1);
    assert.equal(
      w.row("SELECT health_status FROM social_accounts WHERE id='first'").health_status,
      "healthy",
    );
    release.resolve();
    await pending;
    assert.equal(
      await decryptSecret(
        w.row("SELECT access_token_ciphertext v FROM social_accounts WHERE id='first'").v,
        w.env,
      ),
      "winner",
    );
  },
);
check("an expired refresh lease cannot overwrite its newer winner", async (t) => {
  const w = workspace(t);
  await account(w, "first", "x", Date.now() + 1000);
  const started = deferred(),
    release = deferred();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/oauth2/token")) {
      calls++;
      if (calls === 1) {
        started.resolve();
        await release.promise;
        return Response.json({ access_token: "old loser", expires_in: 3600 });
      }
      return Response.json({ access_token: "new winner", expires_in: 3600 });
    }
    return Response.json({ data: { id: "first" } });
  });
  const pending = verifySocialAccount(w.env, "first");
  const failure = assert.rejects(pending, SocialConnectionChanged);
  await started.promise;
  w.exec("UPDATE social_accounts SET refresh_until=0 WHERE id='first'");
  await verifySocialAccount(w.env, "first");
  release.resolve();
  await failure;
  assert.equal(
    await decryptSecret(
      w.row("SELECT access_token_ciphertext v FROM social_accounts WHERE id='first'").v,
      w.env,
    ),
    "new winner",
  );
});
check(
  "missing editor revisions fail closed and launch checks require revision triggers",
  async (t) => {
    const w = workspace(t);
    w.post("post");
    for (const path of [
      "/v1/clients/client-a/brand",
      "/v1/posts/post/edit",
      "/v1/posts/post/approve",
    ]) {
      assert.equal((await send(w, path, {})).status, 428);
    }
    w.exec("DROP TRIGGER post_content_revision");
    const certification = await runLaunchCertification(w.env, {
      id: "owner",
      email: "owner@example.test",
      role: "owner",
    });
    assert.equal(certification.status, "blocked");
    assert.ok(
      certification.checks.some((c) => c.name === "schema:trigger:post_content_revision" && !c.ok),
    );
  },
);
check("OAuth started before disconnect cannot reconnect; a fresh explicit OAuth can", async (t) => {
  const w = workspace(t);
  w.env.X_CLIENT_ID = "fixture-client";
  await account(w, "first", "x");
  const url = new URL(w.env.PUBLIC_BASE_URL + "/social");
  const start = () =>
    socialOAuthStart(w.env, url, "x", "client-a", "owner", w.env.PUBLIC_BASE_URL + "/social");
  const oldState = new URL(await start()).searchParams.get("state");
  await send(w, "/v1/social/accounts/first/disconnect");
  t.mock.method(globalThis, "fetch", async (endpoint) =>
    String(endpoint).includes("/oauth2/token")
      ? Response.json({ access_token: "new OAuth", expires_in: 3600 })
      : Response.json({ data: { id: "first", name: "Account" } }),
  );
  await assert.rejects(
    socialOAuthCallback(
      w.env,
      new URL(w.env.PUBLIC_BASE_URL + "/v1/social/x/callback?code=fixture&state=" + oldState),
      "x",
    ),
    SocialConnectionChanged,
  );
  assert.equal(w.row("SELECT status FROM social_accounts WHERE id='first'").status, "disconnected");
  const freshState = new URL(await start()).searchParams.get("state");
  await socialOAuthCallback(
    w.env,
    new URL(w.env.PUBLIC_BASE_URL + "/v1/social/x/callback?code=fixture&state=" + freshState),
    "x",
  );
  assert.equal(w.row("SELECT status FROM social_accounts WHERE id='first'").status, "connected");
  assert.equal(
    await decryptSecret(
      w.row("SELECT access_token_ciphertext v FROM social_accounts WHERE id='first'").v,
      w.env,
    ),
    "new OAuth",
  );
});
check("OAuth callback rechecks actor authority after provider exchange", async (t) => {
  const w = workspace(t);
  w.env.X_CLIENT_ID = "fixture-client";
  const auth = await socialOAuthStart(
    w.env,
    new URL(w.env.PUBLIC_BASE_URL),
    "x",
    "client-a",
    "owner",
    w.env.PUBLIC_BASE_URL + "/social",
  );
  const state = new URL(auth).searchParams.get("state");
  const started = deferred(),
    release = deferred();
  t.mock.method(globalThis, "fetch", async (endpoint) => {
    if (String(endpoint).includes("/oauth2/token")) {
      started.resolve();
      await release.promise;
      return Response.json({ access_token: "not authorized" });
    }
    return Response.json({ data: { id: "provider", name: "Account" } });
  });
  const pending = socialOAuthCallback(
    w.env,
    new URL(w.env.PUBLIC_BASE_URL + "/v1/social/x/callback?code=fixture&state=" + state),
    "x",
  );
  const failure = assert.rejects(pending, SocialConnectionChanged);
  await started.promise;
  w.exec("UPDATE users SET status='suspended' WHERE id='owner'");
  release.resolve();
  await failure;
  assert.equal(w.row("SELECT COUNT(*) n FROM social_accounts").n, 0);
});
check("approval rechecks destination readiness at the committing transaction", async (t) => {
  const w = workspace(t);
  await account(w);
  w.post("post");
  w.exec("UPDATE posts SET social_account_id='first' WHERE id='post'");
  const revision = postRevision(w);
  const original = w.env.DB.batch,
    started = deferred(),
    release = deferred();
  let held = false;
  w.env.DB.batch = async (statements) => {
    if (!held && statements.length >= 4) {
      held = true;
      started.resolve();
      await release.promise;
    }
    return original(statements);
  };
  const pending = send(w, "/v1/posts/post/approve", { expectedRevision: revision });
  await started.promise;
  await send(w, "/v1/social/accounts/first/disconnect");
  release.resolve();
  assert.equal((await pending).status, 409);
  assert.equal(w.row("SELECT status FROM posts WHERE id='post'").status, "awaiting_approval");
  assert.equal(w.row("SELECT COUNT(*) n FROM approvals").n, 0);
});

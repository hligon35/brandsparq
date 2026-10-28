import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import { socialOAuthStart } from "../cloudflare/src/social.ts";

function start(w, platform) {
  return socialOAuthStart(
    w.env,
    new URL(w.env.PUBLIC_BASE_URL),
    platform,
    "client-a",
    "owner",
    w.env.PUBLIC_BASE_URL + "/social",
  );
}

for (const platform of ["facebook", "instagram"]) {
  test(`${platform} Business Login uses its configuration without overriding permissions`, async (t) => {
    const w = workspace(t);
    w.env.META_APP_ID = "fixture-app";
    w.env.META_APP_SECRET = "fixture-secret";
    w.env.META_LOGIN_CONFIG_ID = " 1234567890123456 ";
    w.env.META_REDIRECT_URI = "https://example.com/v1/social/meta/callback";
    const auth = new URL(await start(w, platform));
    assert.equal(auth.origin, "https://www.facebook.com");
    assert.equal(auth.searchParams.get("config_id"), "1234567890123456");
    assert.equal(auth.searchParams.get("client_id"), "fixture-app");
    assert.equal(auth.searchParams.get("redirect_uri"), w.env.META_REDIRECT_URI);
    assert.equal(auth.searchParams.get("response_type"), "code");
    assert.equal(auth.searchParams.has("scope"), false);
    assert.ok(auth.searchParams.get("state"));
    assert.equal(w.row("SELECT COUNT(*) n FROM social_oauth_states").n, 1);
    assert.equal(auth.toString().includes("fixture-secret"), false);
  });
}

test("legacy Meta Login retains explicit scopes without a configuration", async (t) => {
  const w = workspace(t);
  w.env.META_APP_ID = "fixture-app";
  w.env.META_APP_SECRET = "fixture-secret";
  const auth = new URL(await start(w, "instagram"));
  assert.equal(auth.searchParams.has("config_id"), false);
  assert.equal(auth.searchParams.get("response_type"), "code");
  assert.ok(auth.searchParams.get("scope").split(",").includes("instagram_content_publish"));
});

test("invalid Meta configuration fails before creating an OAuth state", async (t) => {
  const w = workspace(t);
  w.env.META_APP_ID = "fixture-app";
  w.env.META_APP_SECRET = "fixture-secret";
  w.env.META_LOGIN_CONFIG_ID = "not-a-configuration-id";
  await assert.rejects(start(w, "instagram"), /Configuration ID/);
  assert.equal(w.row("SELECT COUNT(*) n FROM social_oauth_states").n, 0);
});

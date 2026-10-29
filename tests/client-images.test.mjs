import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import { socialProfileImage } from "../cloudflare/src/social-profile.ts";
import {
  verifySocialAccount,
  socialOAuthCallback,
  socialOAuthStart,
} from "../cloudflare/src/social.ts";
import { encryptSecret } from "../cloudflare/src/security.ts";

test("profile URLs accept provider formats and reject credentials and unsafe schemes", () => {
  for (const value of [
    { picture: { data: { url: "https://images.example.test/fb.png" } } },
    { profile_picture_url: "https://images.example.test/fb.png" },
    { picture: "https://images.example.test/fb.png" },
    { avatar: "https://images.example.test/fb.png" },
  ])
    assert.equal(socialProfileImage(value), "https://images.example.test/fb.png");
  for (const url of [
    "javascript:alert(1)",
    "data:image/png;base64,abc",
    "https://user:secret@example.test/a.png",
    "https://example.test/a.png?access_token=secret",
    "http://example.test/a.png",
  ])
    assert.equal(socialProfileImage({ profileImageUrl: url }), null);
  assert.equal(socialProfileImage("invalid JSON"), null);
});

test("clients return their connected profile photo without exposing metadata or another client's data", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,status,is_default,metadata) VALUES('fb','client-a','facebook','connected',1,?),('ig','client-a','instagram','connected',1,?),('other','client-b','instagram','connected',1,?)",
    JSON.stringify({
      picture: { data: { url: "https://images.example.test/fb.png" } },
      secret: "never expose",
    }),
    JSON.stringify({ profileImageUrl: "https://images.example.test/ig.png" }),
    JSON.stringify({ profileImageUrl: "https://images.example.test/other.png" }),
  );
  const data = (await (await w.request("/v1/clients", { user: "viewer" })).json()).data;
  assert.equal(data.length, 1);
  assert.equal(data[0].profileImageUrl, "https://images.example.test/ig.png");
  assert.equal(JSON.stringify(data).includes("never expose"), false);
  assert.equal(JSON.stringify(data).includes("other.png"), false);
  w.exec("UPDATE social_accounts SET status='disconnected' WHERE id='ig'");
  assert.equal(
    (await (await w.request("/v1/clients", { user: "viewer" })).json()).data[0].profileImageUrl,
    "https://images.example.test/fb.png",
  );
});

test("verification backfills an existing connection photo while preserving publishing metadata", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,access_token_ciphertext,metadata) VALUES('ig','client-a','instagram','external','connected',?,?)",
    await encryptSecret("token", w.env),
    JSON.stringify({ pageId: "page" }),
  );
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      id: "external",
      username: "business",
      profile_picture_url: "https://images.example.test/ig.png",
    }),
  );
  await verifySocialAccount(w.env, "ig");
  const metadata = JSON.parse(w.row("SELECT metadata FROM social_accounts WHERE id='ig'").metadata);
  assert.equal(metadata.pageId, "page");
  assert.equal(metadata.profileImageUrl, "https://images.example.test/ig.png");
});

test("Meta connection saves Facebook and Instagram photos for the imported client", async (t) => {
  const w = workspace(t);
  w.env.META_APP_ID = "app";
  w.env.META_APP_SECRET = "secret";
  t.mock.method(globalThis, "fetch", async (input) =>
    new URL(input).pathname.endsWith("/oauth/access_token")
      ? Response.json({ access_token: "token" })
      : Response.json({
          data: [
            {
              id: "page",
              name: "Business",
              access_token: "page-token",
              picture: { data: { url: "https://images.example.test/fb.png" } },
              instagram_business_account: {
                id: "ig",
                username: "business",
                profile_picture_url: "https://images.example.test/ig.png",
              },
            },
          ],
        }),
  );
  const auth = new URL(
    await socialOAuthStart(
      w.env,
      new URL(w.env.PUBLIC_BASE_URL),
      "instagram",
      "",
      "owner",
      `${w.env.PUBLIC_BASE_URL}/social`,
      true,
    ),
  );
  const callback = new URL(
    `${w.env.PUBLIC_BASE_URL}/v1/social/meta/callback?code=ok&state=${auth.searchParams.get("state")}`,
  );
  const result = new URL(await socialOAuthCallback(w.env, callback, "meta"));
  const clients = (await (await w.request("/v1/clients", { user: "owner" })).json()).data;
  assert.equal(
    clients.find((c) => c.id === result.searchParams.get("clientId")).profileImageUrl,
    "https://images.example.test/ig.png",
  );
});

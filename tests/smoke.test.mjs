import test from "node:test";
import assert from "node:assert/strict";
import { runProductionSmoke } from "../scripts/lib/production-smoke.mjs";

const base = "https://brandsparq.example.test";
const silent = { log() {}, error() {} };
function responseFor(url) {
  const path = new URL(url).pathname;
  if (path === "/health")
    return Response.json({ ok: true, checks: [{ name: "database", ok: true }] });
  if (path === "/login")
    return new Response("<html><title>BrandSparQ</title></html>", {
      headers: { "content-type": "text/html" },
    });
  if (path === "/v1/auth/google/start")
    return new Response(null, {
      status: 302,
      headers: { location: "https://accounts.google.com/o/oauth2/v2/auth" },
    });
  return Response.json({ error: "Authentication required" }, { status: 401 });
}

test("smoke authenticates the Access layer while retaining anonymous app checks and manual redirects", async () => {
  const seen = [];
  const failures = await runProductionSmoke({
    env: {
      BRANDSPARQ_BASE_URL: base,
      CF_ACCESS_CLIENT_ID: "fixture-id",
      CF_ACCESS_CLIENT_SECRET: "fixture-secret",
    },
    log: silent,
    fetcher: async (url, options) => {
      seen.push(url);
      assert.equal(new URL(url).origin, base);
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.get("CF-Access-Client-Id"), "fixture-id");
      assert.equal(options.headers.get("CF-Access-Client-Secret"), "fixture-secret");
      assert.equal(options.headers.has("authorization"), false);
      assert.equal(options.headers.has("cookie"), false);
      return responseFor(url);
    },
  });
  assert.deepEqual(failures, []);
  assert.equal(seen.length, 4);
});

test("Access challenges fail explicitly and never pass as the app login or API response", async () => {
  const messages = [];
  const failures = await runProductionSmoke({
    env: { BRANDSPARQ_BASE_URL: base },
    log: {
      log: (...args) => messages.push(args.join(" ")),
      error: (...args) => messages.push(args.join(" ")),
    },
    fetcher: async () =>
      new Response(null, {
        status: 302,
        headers: {
          location:
            "https://team.cloudflareaccess.com/cdn-cgi/access/login/example?meta=private-state",
        },
      }),
  });
  assert.equal(failures.length, 4);
  assert.ok(failures.every((failure) => failure.includes("Cloudflare Access blocked")));
  assert.ok(!messages.some((message) => message.includes("PASS:")));
  assert.ok(!messages.some((message) => message.includes("private-state")));
});

test("Access HTML returning 200 is not accepted as a working login SPA", async () => {
  const failures = await runProductionSmoke({
    env: { BRANDSPARQ_BASE_URL: base },
    log: silent,
    fetcher: async () =>
      new Response("<html>BrandSparQ — Cloudflare Access</html>", {
        headers: { "content-type": "text/html" },
      }),
  });
  assert.equal(failures.length, 4);
  assert.ok(failures.every((failure) => failure.includes("Cloudflare Access blocked")));
});

test("an edge HTML 401 cannot certify the Worker auth guard", async () => {
  const failures = await runProductionSmoke({
    env: { BRANDSPARQ_BASE_URL: base },
    log: silent,
    fetcher: async (url) =>
      new URL(url).pathname === "/v1/dashboard"
        ? new Response("<html>Unauthorized</html>", {
            status: 401,
            headers: { "content-type": "text/html" },
          })
        : responseFor(url),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /Worker JSON error/);
});

test("incomplete service credentials and unsafe origins fail before any request", async () => {
  for (const env of [
    { BRANDSPARQ_BASE_URL: base, CF_ACCESS_CLIENT_ID: "fixture-id" },
    {
      BRANDSPARQ_BASE_URL: "http://example.test",
      CF_ACCESS_CLIENT_ID: "fixture-id",
      CF_ACCESS_CLIENT_SECRET: "fixture-secret",
    },
    { BRANDSPARQ_BASE_URL: "https://user:password@example.test" },
  ]) {
    await assert.rejects(
      runProductionSmoke({
        env,
        log: silent,
        fetcher: async () => {
          assert.fail("must not fetch");
        },
      }),
      /HTTPS origin|Set both/,
    );
  }
});

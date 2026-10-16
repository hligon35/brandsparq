import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { encryptSecret, decryptSecret, hashSecret } from "../cloudflare/src/security.ts";
import { hasPermission } from "../cloudflare/src/authz.ts";
import { creativeProfile, deterministicComposition } from "../cloudflare/src/creative.ts";
import { extractOutputText } from "../cloudflare/src/ai/openai.ts";

test("staging smoke rejects absent, production and malformed targets before network access", () => {
  for (const target of [
    "",
    "https://brandsparq.getsparqd.com",
    "http://localhost:8788",
    "https://staging.example/path",
    "https://user:password@staging.example",
    "https://staging.example?token=test",
  ]) {
    const result = spawnSync(process.execPath, ["scripts/smoke-staging.mjs"], {
      env: { ...process.env, BRANDSPARQ_BASE_URL: target },
      encoding: "utf8",
      timeout: 2000,
    });
    assert.equal(result.status, 1, `must reject ${target || "missing origin"}`);
    assert.equal(result.error, undefined);
    assert.match(result.stderr, /staging origin|HTTPS origin|production domain/);
  }
});

test("encrypted provider tokens round-trip with unique nonces and reject the wrong key or tampering", async () => {
  const env = { SOCIAL_TOKEN_KEY: "test-key" };
  const first = await encryptSecret("secret-token", env);
  const second = await encryptSecret("secret-token", env);
  assert.notEqual(first, second);
  assert.equal(await decryptSecret(first, env), "secret-token");
  assert.equal(first.includes("secret-token"), false);
  await assert.rejects(decryptSecret(first, { SOCIAL_TOKEN_KEY: "wrong-key" }));
  const parts = first.split(".");
  const bytes = Buffer.from(parts[2], "base64");
  bytes[0] ^= 1;
  await assert.rejects(decryptSecret(`${parts[0]}.${parts[1]}.${bytes.toString("base64")}`, env));
  await assert.rejects(encryptSecret("token", {}), /not configured/);
});

test("token hashes are deterministic and pepper-specific", async () => {
  assert.equal(await hashSecret("value", "a"), await hashSecret("value", "a"));
  assert.notEqual(await hashSecret("value", "a"), await hashSecret("value", "b"));
});

test("roles apply least privilege and unknown roles never receive mutation permissions", () => {
  for (const role of ["viewer", "invalid", "OWNER-TYPO"]) {
    assert.equal(hasPermission({ role }, "publish"), false);
    assert.equal(hasPermission({ role }, "system_manage"), false);
  }
  assert.equal(hasPermission({ role: "reviewer" }, "review"), true);
  assert.equal(hasPermission({ role: "reviewer" }, "publish"), false);
  assert.equal(hasPermission({ role: "publisher" }, "publish"), true);
  assert.equal(hasPermission({ role: "publisher" }, "review"), false);
  assert.equal(hasPermission({ role: "admin" }, "system_manage"), false);
  assert.equal(hasPermission({ role: "owner" }, "system_manage"), true);
});

test("creative geometry uses appropriate platform dimensions and safe text/logo placement", () => {
  assert.equal(creativeProfile("instagram").aspectRatio, "4:5");
  assert.equal(creativeProfile("linkedin").aspectRatio, "3:2");
  const plan = deterministicComposition({
    platform: "tiktok",
    headline: "Community first",
    cta: "Learn more",
    logoAssetId: "logo",
    primaryColor: "#123456",
  });
  assert.equal(plan.canvas.height > plan.canvas.width, true);
  assert.equal(plan.headline.anchor, "top_left");
  assert.equal(plan.logo.assetId, "logo");
  assert.equal(plan.colors.primary, "#123456");
  assert.equal(plan.safeArea.left > 0, true);
});

test("structured output extraction handles both documented shapes and absent output", () => {
  assert.equal(extractOutputText({ output_text: '{"ok":true}' }), '{"ok":true}');
  assert.equal(
    extractOutputText({ output: [{ content: [{ type: "output_text", text: "answer" }] }] }),
    "answer",
  );
  assert.equal(extractOutputText({ output: [{ type: "reasoning" }] }), "");
});

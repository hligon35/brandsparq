import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("staging configuration rejects production bindings and derives only isolated resources", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "brandsparq-staging-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "cloudflare"));
  copyFileSync(
    new URL("../cloudflare/wrangler.toml", import.meta.url),
    join(dir, "cloudflare/wrangler.toml"),
  );
  const script = fileURLToPath(new URL("../scripts/staging-config.mjs", import.meta.url));
  const env = {
    ...process.env,
    BRANDSPARQ_STAGING_ORIGIN: "https://brandsparq-staging.fixture.workers.dev",
    BRANDSPARQ_STAGING_DATABASE_ID: "00000000-0000-4000-8000-000000000001",
    BRANDSPARQ_STAGING_GOOGLE_CLIENT_ID: "fixture.apps.googleusercontent.com",
  };
  const run = (extra) =>
    execFileSync(process.execPath, [script], {
      cwd: dir,
      env: { ...env, ...extra },
      stdio: "pipe",
    });
  assert.throws(() => run({ BRANDSPARQ_STAGING_ORIGIN: "https://brandsparq.getsparqd.com" }));
  assert.throws(() =>
    run({ BRANDSPARQ_STAGING_DATABASE_ID: "1f6f0d67-1725-4f19-8fd9-0f80f600f5b1" }),
  );
  run({});
  const config = readFileSync(join(dir, "cloudflare/wrangler.staging.toml"), "utf8");
  assert.ok(!config.includes("brandsparq.getsparqd.com"));
  assert.ok(!config.includes("custom_domain"));
  for (const name of ["media", "publish", "generation", "publish-dlq", "generation-dlq"])
    assert.ok(config.includes(`"brandsparq-staging-${name}"`));
  assert.ok(config.includes('ENVIRONMENT = "staging"'));
});

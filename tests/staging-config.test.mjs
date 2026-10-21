import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
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

test("staging rejects case variations of the production database and unmapped resource additions", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "brandsparq-staging-layout-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "cloudflare"));
  const production = readFileSync(new URL("../cloudflare/wrangler.toml", import.meta.url), "utf8");
  writeFileSync(join(dir, "cloudflare/wrangler.toml"), production);
  const script = fileURLToPath(new URL("../scripts/staging-config.mjs", import.meta.url));
  const env = {
    ...process.env,
    BRANDSPARQ_STAGING_ORIGIN: "https://brandsparq-staging.fixture.workers.dev",
    BRANDSPARQ_STAGING_DATABASE_ID: "1F6F0D67-1725-4F19-8FD9-0F80F600F5B1",
    BRANDSPARQ_STAGING_GOOGLE_CLIENT_ID: "fixture.apps.googleusercontent.com",
  };
  assert.throws(() => execFileSync(process.execPath, [script], { cwd: dir, env, stdio: "pipe" }));
  env.BRANDSPARQ_STAGING_DATABASE_ID = "00000000-0000-4000-8000-000000000001";
  writeFileSync(
    join(dir, "cloudflare/wrangler.toml"),
    production + '\n[[kv_namespaces]]\nbinding="NEW_CACHE"\nid="production-cache"\n',
  );
  assert.throws(() => execFileSync(process.execPath, [script], { cwd: dir, env, stdio: "pipe" }));
});

test("staging deploy forces same-origin API configuration and validates before deploying", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "brandsparq-staging-build-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "cloudflare"));
  copyFileSync(
    new URL("../cloudflare/wrangler.toml", import.meta.url),
    join(dir, "cloudflare/wrangler.toml"),
  );
  const script = fileURLToPath(new URL("../scripts/deploy-staging.mjs", import.meta.url));
  const fakeCli = join(dir, "fake-npm.cjs");
  const log = join(dir, "commands.jsonl");
  writeFileSync(
    fakeCli,
    `require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),api:process.env.EXPO_PUBLIC_API_URL})+'\\n');`,
  );
  const env = {
    ...process.env,
    npm_execpath: fakeCli,
    EXPO_PUBLIC_API_URL: "https://brandsparq.getsparqd.com",
    BRANDSPARQ_STAGING_ORIGIN: "https://brandsparq-staging.fixture.workers.dev",
    BRANDSPARQ_STAGING_DATABASE_ID: "00000000-0000-4000-8000-000000000001",
    BRANDSPARQ_STAGING_GOOGLE_CLIENT_ID: "fixture.apps.googleusercontent.com",
  };
  execFileSync(process.execPath, [script], { cwd: dir, env, stdio: "pipe" });
  const commands = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    commands.map((command) => command.args),
    [
      ["run", "validate"],
      ["--prefix", "cloudflare", "run", "deploy:staging"],
    ],
  );
  assert.ok(commands.every((command) => command.api === ""));
  writeFileSync(log, "");
  writeFileSync(
    fakeCli,
    `require('node:fs').writeFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2)));process.exit(2);`,
  );
  assert.throws(() => execFileSync(process.execPath, [script], { cwd: dir, env, stdio: "pipe" }));
  assert.deepEqual(JSON.parse(readFileSync(log, "utf8")), ["run", "validate"]);
});

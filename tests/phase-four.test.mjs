import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { accepted } from "./fixtures/release-report.mjs";
import {
  DEVICE_CHECKS,
  PROVIDER_CHECKS,
  verifyHostedCI,
} from "../scripts/lib/acceptance-matrix.mjs";
import { verifyReleaseEvidence } from "../scripts/lib/release-evidence.mjs";
import { verifyRestore, verifyRestoredTokens } from "../scripts/lib/restore-verification.mjs";
import { assessAudit } from "../scripts/lib/dependency-disposition.mjs";
import { encryptSecret } from "../cloudflare/src/security.ts";
const require = createRequire(import.meta.url);
const verify = (report) => verifyReleaseEvidence(report, { commit: report.releaseCommit });

test("every physical device acceptance scenario is required and freshly evidenced", () => {
  for (const platform of ["android", "ios"])
    for (const name of DEVICE_CHECKS) {
      const report = accepted();
      delete report.gates[platform].checks[name];
      assert.throws(() => verify(report), new RegExp(`${platform}.${name}`));
    }
  for (const patch of [
    { fixtureBuild: true },
    { apiOrigin: "https://brandsparq.getsparqd.com" },
    { channel: "production" },
    { buildProfile: "e2e" },
    { runtimeVersion: "0.1.0" },
  ]) {
    const report = accepted();
    Object.assign(report.gates.android, patch);
    assert.throws(() => verify(report), /physical staging/);
  }
  const report = accepted();
  report.gates.ios.checks.oauth_cold.recordedAt = "2000-01-01";
  assert.throws(() => verify(report), /ios.oauth_cold/);
});
test("provider acceptance requires real receipt identity and every provider-specific scenario", () => {
  for (const name of PROVIDER_CHECKS) {
    const report = accepted();
    delete report.gates.providers.results.facebook.checks[name];
    assert.throws(() => verify(report), new RegExp(`facebook.${name}`));
  }
  const report = accepted();
  report.gates.providers.results.facebook.providerPostId = "";
  assert.throws(() => verify(report), /actual provider receipt/);
  const unsupported = accepted();
  unsupported.gates.providers.results.facebook.checks.webhook_signature_replay.status =
    "not_applicable";
  assert.throws(() => verify(unsupported), /facebook.webhook/);
});
test("bare gate attestations and incomplete restoration receipts cannot unlock release", () => {
  const report = accepted();
  delete report.attestationVersion;
  assert.throws(() => verify(report), /Version 2/);
  for (const patch of [
    { disconnected: false },
    { liveSessionsRevoked: false },
    { missingObjects: 1 },
    { corruptObjects: 1 },
    { foreignKeysVerified: false },
    { sqlSha256: "missing" },
  ]) {
    const report = accepted();
    Object.assign(report.gates.restore, patch);
    assert.throws(() => verify(report), /disconnected restoration/);
  }
});
test("hosted CI is read live and must match repository, run ID, quality workflow, exact commit and successful completion", async () => {
  const gate = { runId: 123 },
    commit = "a".repeat(40);
  const run = {
    id: 123,
    repository: { full_name: "hligon35/brandsparq" },
    head_sha: commit,
    path: ".github/workflows/ci.yml",
    name: "BrandSparQ CI",
    status: "completed",
    conclusion: "success",
  };
  assert.equal(
    (
      await verifyHostedCI(gate, commit, {
        fetcher: async (url, options) => {
          assert.equal(url, "https://api.github.com/repos/hligon35/brandsparq/actions/runs/123");
          assert.equal(options.redirect, "error");
          return Response.json(run);
        },
      })
    ).conclusion,
    "success",
  );
  for (const patch of [
    { head_sha: "b".repeat(40) },
    { status: "queued" },
    { path: ".github/workflows/staging-smoke.yml" },
    { name: "Unrelated successful check" },
    { conclusion: "failure" },
    { repository: { full_name: "other/repo" } },
    { id: 124 },
  ])
    await assert.rejects(
      verifyHostedCI(gate, commit, { fetcher: async () => Response.json({ ...run, ...patch }) }),
      /exact release commit/,
    );
  await assert.rejects(
    verifyHostedCI(gate, commit, { fetcher: async () => new Response("", { status: 403 }) }),
    /remains blocked/,
  );
});
function restoreFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "brandsparq-phase4-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sql =
    "CREATE TABLE users(id TEXT);CREATE TABLE clients(id TEXT);CREATE TABLE assets(id TEXT,r2_key TEXT);CREATE TABLE posts(id TEXT,graphic_key TEXT);";
  const manifest = {
    source: "isolated-fixture",
    capturedAt: new Date().toISOString(),
    counts: { users: 0, clients: 0, assets: 0, posts: 0 },
    media: [],
  };
  return { directory, sql, manifest };
}
test("offline restoration cannot attach external databases or write a VACUUM archive", (t) => {
  const { directory, sql, manifest } = restoreFixture(t);
  for (const payload of [
    "ATTACH DATABASE 'outside.db' AS other;",
    "VACUUM INTO 'outside.db';",
    "PRAGMA writable_schema=ON;",
    'PRAGMA "writable_schema"=ON;',
    "PRAGMA 'temp_store_directory'='/tmp';",
  ])
    assert.throws(
      () => verifyRestore({ sql: sql + payload, manifest, mediaDirectory: directory }),
      /forbidden/,
    );
  const receipt = verifyRestore({
    sql: sql + "INSERT INTO users VALUES('ATTACH DATABASE is caption text');",
    manifest: { ...manifest, counts: { ...manifest.counts, users: 1 } },
    mediaDirectory: directory,
  });
  assert.equal(receipt.remoteRestoreVerified, false);
  assert.match(receipt.sqlSha256, /^[a-f0-9]{64}$/);
});
test("restored-media symlinks cannot escape the archive even with a matching checksum", (t) => {
  const { directory, sql, manifest } = restoreFixture(t),
    outer = mkdtempSync(join(tmpdir(), "brandsparq-outside-"));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  writeFileSync(join(outer, "private"), "external");
  symlinkSync(join(outer, "private"), join(directory, "escape"));
  manifest.media = [
    {
      key: "object",
      file: "escape",
      sha256: createHash("sha256").update("external").digest("hex"),
    },
  ];
  assert.throws(
    () => verifyRestore({ sql, manifest, mediaDirectory: directory }),
    /symlink leaves/,
  );
});
test("restored provider tokens decrypt using the retained key without leaking tokens into evidence", async () => {
  const key = "isolated-fixture-key",
    token = "never-print-this-provider-token";
  const payload = await encryptSecret(token, { SOCIAL_TOKEN_KEY: key });
  const sql = `CREATE TABLE social_accounts(access_token_ciphertext TEXT,refresh_token_ciphertext TEXT);INSERT INTO social_accounts VALUES('${payload}','${payload}');`;
  const receipt = verifyRestoredTokens({ sql, key });
  assert.equal(receipt.encryptedTokensVerified, 2);
  assert.equal(receipt.remoteRestoreVerified, false);
  assert.equal(JSON.stringify(receipt).includes(token), false);
  assert.throws(() => verifyRestoredTokens({ sql, key: "wrong" }), /decryption failed/);
  assert.throws(() => verifyRestoredTokens({ sql }), /retained/);
});
test("Forge patch retains Expo signing compatibility and regressions are not allowlisted", () => {
  const forge = require("node-forge");
  assert.equal(require("node-forge/package.json").version, "1.4.2");
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 }),
    digest = forge.md.sha256.create();
  digest.update("fixture");
  const signature = keys.privateKey.sign(digest);
  assert.equal(keys.publicKey.verify(digest.digest().bytes(), signature), true);
  const altered = forge.md.sha256.create();
  altered.update("changed");
  assert.equal(keys.publicKey.verify(altered.digest().bytes(), signature), false);
  assert.throws(
    () =>
      assessAudit(
        {
          metadata: { vulnerabilities: { high: 1 } },
          vulnerabilities: {
            forge: {
              name: "node-forge",
              nodes: ["node_modules/node-forge"],
              via: [{ url: "https://github.com/advisories/GHSA-86w9-cpqp-85rv" }],
            },
          },
        },
        { packages: { "node_modules/node-forge": { version: "1.4.0" } } },
      ),
    /Unreviewed/,
  );
});
test("fixture native app has its own identity, loopback API and disabled OTA", (t) => {
  const configure = require("../app.config.js"),
    config = require("../app.json").expo;
  const names = [
    "BRANDSPARQ_APP_ENV",
    "EXPO_PUBLIC_API_URL",
    "BRANDSPARQ_E2E_BUILD",
    "EAS_BUILD_PROFILE",
  ];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  });
  delete process.env.BRANDSPARQ_APP_ENV;
  process.env.BRANDSPARQ_E2E_BUILD = "1";
  process.env.EAS_BUILD_PROFILE = "e2e";
  process.env.EXPO_PUBLIC_API_URL = "https://brandsparq.getsparqd.com";
  assert.throws(() => configure({ config }), /loopback/);
  process.env.EXPO_PUBLIC_API_URL = "http://127.0.0.1:8788";
  const fixture = configure({ config });
  assert.equal(fixture.ios.bundleIdentifier, `${config.ios.bundleIdentifier}.e2e`);
  assert.equal(fixture.android.package, `${config.android.package}.e2e`);
  assert.equal(fixture.scheme, "brandsparq-e2e");
  assert.equal(fixture.updates.enabled, false);
  const flow = readFileSync(new URL("../.maestro/workspace.yaml", import.meta.url), "utf8");
  assert.match(flow, /brandsparq\.e2e/);
  assert.equal(flow.includes("Marketing moves faster"), false);
  assert.equal(flow.includes("Clients & Brand Brain"), false);
});

test("supervised pilot activation and queued claims must match the deployed release", async (t) => {
  const { workspace } = await import("./workspace.mjs");
  const { configurePilot } = await import("../cloudflare/src/pilot.ts");
  const { ensurePublishJob, claimPublishJob } = await import("../cloudflare/src/publishing.ts");
  const w = workspace(t),
    report = accepted();
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,status) VALUES('destination','client-a','facebook','connected')",
  );
  const input = {
    mode: "supervised",
    expectedRevision: 0,
    releaseCommit: report.releaseCommit,
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    destinations: [{ clientId: "client-a", socialAccountId: "destination" }],
    evidence: Object.fromEntries(
      Object.entries(report.gates).map(([name, gate]) => [name, gate.evidenceUrl]),
    ),
  };
  delete w.env.RELEASE_COMMIT;
  assert.equal((await configurePilot(w.env, { id: "owner", role: "owner" }, input)).status, 409);
  w.env.RELEASE_COMMIT = "b".repeat(40);
  assert.equal((await configurePilot(w.env, { id: "owner", role: "owner" }, input)).status, 409);
  w.env.RELEASE_COMMIT = report.releaseCommit;
  assert.equal((await configurePilot(w.env, { id: "owner", role: "owner" }, input)).body.ok, true);
  w.post("p", "client-a", "calendar_scheduled");
  w.exec(
    "UPDATE posts SET social_account_id='destination',prepublish_response='publish_now' WHERE id='p'",
  );
  const job = await ensurePublishJob(w.env, "p", null, "owner");
  w.env.RELEASE_COMMIT = "b".repeat(40);
  assert.equal((await claimPublishJob(w.env, job.jobId)).claimed, false);
});
test("unresolved provider outcomes block pilot activation without changing the current hold", async (t) => {
  const { workspace } = await import("./workspace.mjs");
  const { configurePilot } = await import("../cloudflare/src/pilot.ts");
  const w = workspace(t),
    report = accepted();
  w.exec("UPDATE pilot_settings SET mode='hold'");
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,status) VALUES('destination','client-a','facebook','connected')",
  );
  w.post("unknown", "client-a", "failed");
  w.exec("UPDATE posts SET failure_code='PUBLISH_OUTCOME_UNKNOWN' WHERE id='unknown'");
  const result = await configurePilot(
    w.env,
    { id: "owner", role: "owner" },
    {
      mode: "supervised",
      expectedRevision: 0,
      releaseCommit: report.releaseCommit,
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      destinations: [{ clientId: "client-a", socialAccountId: "destination" }],
      evidence: Object.fromEntries(
        Object.entries(report.gates).map(([name, gate]) => [name, gate.evidenceUrl]),
      ),
    },
  );
  assert.equal(result.status, 409);
  assert.equal(w.row("SELECT mode FROM pilot_settings").mode, "hold");
  assert.equal(w.row("SELECT COUNT(*) AS n FROM pilot_destinations").n, 0);
});
test("pilot plan is limited to the accepted receipt destination and a held matching deployment", async () => {
  const { preparePilotPlan } = await import("../scripts/lib/pilot-plan.mjs");
  const report = accepted(),
    options = {
      commit: report.releaseCommit,
      pilot: {
        mode: "hold",
        deployedCommit: report.releaseCommit,
        inFlight: 0,
        revision: 2,
        availableDestinations: [{ clientId: "client", socialAccountId: "destination" }],
      },
      clientId: "client",
      socialAccountId: "destination",
      endsAt: new Date(Date.now() + 3600000).toISOString(),
    };
  assert.equal(preparePilotPlan(report, options).expectedRevision, 2);
  assert.throws(
    () => preparePilotPlan(report, { ...options, socialAccountId: "other" }),
    /exact active destination/,
  );
  assert.throws(
    () => preparePilotPlan(report, { ...options, pilot: { ...options.pilot, mode: "normal" } }),
    /current hold/,
  );
  assert.throws(
    () =>
      preparePilotPlan(report, {
        ...options,
        endsAt: new Date(Date.now() + 8 * 86400000).toISOString(),
      }),
    /seven days/,
  );
});

test("all migrated tables and source, derivative, graphic and variant objects survive a disconnected fixture restore", async (t) => {
  const { workspace } = await import("./workspace.mjs");
  const w = workspace(t);
  const dir = mkdtempSync(join(tmpdir(), "brandsparq-full-restore-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  w.exec(
    "INSERT INTO assets(id,client_id,r2_key,filename,content_type) VALUES('asset','client-a','source','source.png','image/png')",
  );
  w.exec(
    "INSERT INTO asset_derivatives(id,asset_id,kind,r2_key,content_type) VALUES('derivative','asset','analysis','analysis','image/jpeg')",
  );
  w.post("restored");
  w.exec("UPDATE posts SET graphic_key='graphic' WHERE id='restored'");
  w.exec(
    "INSERT INTO creative_variants(id,post_id,platform,variant_key,aspect_ratio,r2_key) VALUES('variant','restored','facebook','square','1:1','variant')",
  );
  const payload = await encryptSecret("fixture-only-token", {
    SOCIAL_TOKEN_KEY: w.env.SOCIAL_TOKEN_KEY,
  });
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,access_token_ciphertext) VALUES('encrypted','client-a','facebook',?)",
    payload,
  );
  const schema = w.sqlite
    .prepare(
      "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  const tables = schema.filter((item) => item.type === "table");
  const quote = (value) =>
    value === null
      ? "NULL"
      : typeof value === "number"
        ? String(value)
        : "'" + String(value).replaceAll("'", "''") + "'";
  let sql = "PRAGMA foreign_keys=OFF;" + tables.map((item) => item.sql + ";").join("\n");
  const counts = {};
  for (const table of tables) {
    const rows = w.sqlite.prepare(`SELECT * FROM "${table.name}" ORDER BY rowid`).all();
    counts[table.name] = rows.length;
    for (const row of rows)
      sql += `\nINSERT INTO "${table.name}" VALUES(${Object.values(row).map(quote).join(",")});`;
  }
  sql +=
    "\n" +
    schema
      .filter((item) => item.type !== "table")
      .map((item) => item.sql + ";")
      .join("\n");
  const media = ["source", "analysis", "graphic", "variant"].map((key) => {
    const bytes = Buffer.from(`fixture-${key}`);
    writeFileSync(join(dir, key), bytes);
    return { key, file: key, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  const receipt = verifyRestore({
    sql,
    manifest: {
      source: "fixture-not-production",
      capturedAt: new Date().toISOString(),
      counts,
      media,
    },
    mediaDirectory: dir,
  });
  assert.equal(receipt.mediaVerified, 4);
  assert.equal(receipt.remoteRestoreVerified, false);
  assert.ok(Object.keys(receipt.counts).length > 30);
  assert.equal(
    verifyRestoredTokens({ sql, key: w.env.SOCIAL_TOKEN_KEY }).encryptedTokensVerified,
    1,
  );
});

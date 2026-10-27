import { accepted } from "./fixtures/release-report.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { assessAudit } from "../scripts/lib/dependency-disposition.mjs";
import { RELEASE_GATES, verifyReleaseEvidence } from "../scripts/lib/release-evidence.mjs";
import { verifyProductionState } from "../scripts/lib/production-preflight.mjs";
import { checkAccessRouting } from "../scripts/lib/access-routing.mjs";
const require = createRequire(import.meta.url);

test("routing acceptance never sends Access credentials and rejects edge challenges or unsigned webhook admission", async () => {
  const report = await checkAccessRouting({
    origin: "https://example.test",
    fetcher: async (_url, options) => {
      assert.equal(options.redirect, "manual");
      assert.equal(new Headers(options.headers).has("CF-Access-Client-Secret"), false);
      return new Response("Access", {
        status: 302,
        headers: { location: "https://example.cloudflareaccess.com/" },
      });
    },
  });
  assert.equal(report.passed, false);
  assert.equal(report.checks.length, 11);
});

test("production preflight rejects pending migrations, automatic publishing and an in-flight publisher", () => {
  const result = () => [
    { success: true, results: [{ name: "0023_schedule_reservations.sql" }] },
    { success: true, results: [{ mode: "hold", no_response_policy: "hold" }] },
    { success: true, results: [{ in_flight: 0 }] },
  ];
  const migrations = ["0023_schedule_reservations.sql"];
  assert.equal(verifyProductionState(result(), migrations).pilotMode, "hold");
  assert.throws(
    () => verifyProductionState(result(), [...migrations, "0024_missing.sql"]),
    /pending/,
  );
  const automatic = result();
  automatic[1].results[0].no_response_policy = "auto_publish";
  assert.throws(() => verifyProductionState(automatic, migrations), /Hold/);
  const claimed = result();
  claimed[2].results[0].in_flight = 1;
  assert.throws(() => verifyProductionState(claimed, migrations), /in-flight/);
});

test("release admission rejects missing, stale, wrong-commit and incomplete actual acceptance", () => {
  let report = accepted();
  const options = { commit: report.releaseCommit };
  assert.equal(verifyReleaseEvidence(report, options).status, "attested");
  for (const name of RELEASE_GATES) {
    report = accepted();
    report.gates[name].status = "blocked";
    assert.throws(() => verifyReleaseEvidence(report, options), /blocked/);
  }
  report = accepted();
  report.releaseCommit = "b".repeat(40);
  assert.throws(() => verifyReleaseEvidence(report, options), /exact/);
  report = accepted();
  report.recordedAt = "2000-01-01";
  assert.throws(() => verifyReleaseEvidence(report, options), /seven days/);
  report = accepted();
  report.gates.android.physicalDevice = false;
  assert.throws(() => verifyReleaseEvidence(report, options), /physical device/);
  report = accepted();
  report.gates.restore.restoreDatabaseId = "1f6f0d67-1725-4f19-8fd9-0f80f600f5b1";
  assert.throws(() => verifyReleaseEvidence(report, options), /isolated/);
  report = accepted();
  report.gates.advisories.ownerAccepted = false;
  assert.throws(() => verifyReleaseEvidence(report, options), /owner/);
});

test("dependency checks track only the reviewed package/version and block unknown issues or unaccepted releases", () => {
  const report = {
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    vulnerabilities: {
      zod: {
        name: "zod",
        nodes: ["node_modules/zod"],
        via: [{ url: "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5" }],
      },
    },
  };
  const lock = { packages: { "node_modules/zod": { version: "3.25.76" } } };
  const options = { now: Date.parse("2026-10-25") };
  assert.equal(assessAudit(report, lock, options).securityClear, false);
  assert.throws(() => assessAudit(report, lock, { ...options, release: true }), /owner/);
  assert.throws(() => assessAudit(report, lock, { now: Date.parse("2026-11-09") }), /expired/);
  report.vulnerabilities["zod"].via[0].url += "-unknown";
  assert.throws(() => assessAudit(report, lock, options), /Unreviewed/);
});

test("staging mobile configuration refuses production and fixture networking cannot enter release profiles", (t) => {
  const configure = require("../app.config.js");
  const config = require("../app.json").expo;
  const previous = { ...process.env };
  t.after(() => {
    for (const key of [
      "BRANDSPARQ_APP_ENV",
      "EXPO_PUBLIC_API_URL",
      "BRANDSPARQ_E2E_BUILD",
      "EAS_BUILD_PROFILE",
    ]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  process.env.BRANDSPARQ_APP_ENV = "staging";
  process.env.EXPO_PUBLIC_API_URL = "https://brandsparq.getsparqd.com";
  assert.throws(() => configure({ config }), /isolated staging/);
  process.env.EXPO_PUBLIC_API_URL = "https://brandsparq-staging.test.workers.dev";
  const staging = configure({ config });
  assert.equal(staging.scheme, "brandsparq-staging");
  assert.match(staging.ios.bundleIdentifier, /\.staging$/);
  assert.match(staging.android.package, /\.staging$/);
  process.env.BRANDSPARQ_E2E_BUILD = "1";
  process.env.EAS_BUILD_PROFILE = "production";
  assert.throws(() => configure({ config }), /restricted/);
});

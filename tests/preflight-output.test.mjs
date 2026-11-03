import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  parseWranglerD1Output,
  verifyProductionState,
} from "../scripts/lib/production-preflight.mjs";
const result = () => [
  { success: true, results: [{ name: "0031_test.sql" }] },
  { success: true, results: [{ mode: "hold", no_response_policy: "hold" }] },
  { success: true, results: [{ in_flight: 0 }] },
];
test("preflight parses clean and banner-wrapped D1 output including ANSI and CRLF", () => {
  const data = result();
  for (const output of [
    JSON.stringify(data),
    "\uFEFF" + JSON.stringify(data),
    "\u001b[34m ⛅️ wrangler 4.151.3\u001b[0m\r\n[WARNING] configuration\r\n" +
      JSON.stringify(data) +
      "\r\nLogs written.",
  ])
    assert.deepEqual(parseWranglerD1Output(output), data);
});
test("banner parsing cannot turn failed, missing or ambiguous production checks into acceptance", () => {
  assert.throws(() => parseWranglerD1Output("⛅️ wrangler\nNot authenticated"), /unambiguous/);
  assert.throws(
    () =>
      parseWranglerD1Output(
        "banner\n" + JSON.stringify(result()) + "\n" + JSON.stringify(result()),
      ),
    /unambiguous/,
  );
  const failed = result();
  failed[0].success = false;
  assert.throws(
    () =>
      verifyProductionState(parseWranglerD1Output("banner\n" + JSON.stringify(failed)), [
        "0031_test.sql",
      ]),
    /expected D1/,
  );
  assert.throws(
    () =>
      verifyProductionState(parseWranglerD1Output("banner\n" + JSON.stringify(result())), [
        "0032_missing.sql",
      ]),
    /pending production migrations/,
  );
  const active = result();
  active[2].results[0].in_flight = 1;
  assert.throws(
    () =>
      verifyProductionState(parseWranglerD1Output("banner\n" + JSON.stringify(active)), [
        "0031_test.sql",
      ]),
    /in-flight/,
  );
});
test("preflight invokes the local Wrangler bin with intact JSON and SQL arguments from a path with spaces", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "brandsparq production check "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  mkdirSync(join(dir, "cloudflare/node_modules/wrangler/bin"), { recursive: true });
  mkdirSync(join(dir, "cloudflare/migrations"), { recursive: true });
  for (const file of ["preflight-production.mjs", "lib/production-preflight.mjs"])
    writeFileSync(
      join(dir, "scripts", file),
      readFileSync(new URL("../scripts/" + file, import.meta.url)),
    );
  writeFileSync(join(dir, "cloudflare/package.json"), "{}");
  writeFileSync(join(dir, "cloudflare/migrations/0031_test.sql"), "-- test");
  writeFileSync(
    join(dir, "cloudflare/node_modules/wrangler/package.json"),
    JSON.stringify({ name: "wrangler", bin: { wrangler: "bin/cli.cjs" } }),
  );
  writeFileSync(
    join(dir, "cloudflare/node_modules/wrangler/bin/cli.cjs"),
    `const a=process.argv.slice(2);if(!a.includes('--json')||!a[a.indexOf('--command')+1].includes('SELECT name FROM d1_migrations;'))process.exit(2);console.log(' ⛅️ wrangler 4.151.3');console.log(${JSON.stringify(JSON.stringify(result()))});`,
  );
  const run = spawnSync(process.execPath, [join(dir, "scripts/preflight-production.mjs")], {
    cwd: tmpdir(),
    env: { ...process.env, npm_execpath: "intentionally-not-an-executable" },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).pilotMode, "hold");
});

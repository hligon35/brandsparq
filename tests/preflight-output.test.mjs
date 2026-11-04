import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  parseWranglerD1Output,
  readProductionChecks,
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
    `const a=process.argv.slice(2),sql=a[a.indexOf('--command')+1];
     if(!a.includes('--json')||!sql||sql.includes(String.fromCharCode(10))||sql.includes(String.fromCharCode(13)))process.exit(2);
     require('node:fs').appendFileSync(${JSON.stringify(join(dir, "calls.jsonl"))},JSON.stringify(a)+String.fromCharCode(10));
     const rows=${JSON.stringify(result())};
     const index=sql.includes('d1_migrations')?0:sql.includes('pilot_settings')?1:2;
     console.log(' ⛅️ wrangler 4.151.3');console.log(JSON.stringify([rows[index]]));`,
  );
  const run = spawnSync(process.execPath, [join(dir, "scripts/preflight-production.mjs")], {
    cwd: tmpdir(),
    env: { ...process.env, npm_execpath: "intentionally-not-an-executable" },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).pilotMode, "hold");
  const calls = readFileSync(join(dir, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(calls.length, 3);
  assert.ok(calls.every((args) => args.includes("--command") && !args.includes("--file")));
});

test("preflight combines three single-query responses and retains all publishing guards", () => {
  const data = result();
  const calls = [];
  const run = (executable, args, options) => {
    calls.push({ executable, args, options });
    return {
      status: 0,
      stdout: "[WARNING] config\r\n" + JSON.stringify([data[calls.length - 1]]),
      stderr: "",
    };
  };
  const checks = readProductionChecks({
    cli: "C:/Project with spaces/cli.cjs",
    cwd: "C:/Project with spaces",
    run,
  });
  assert.deepEqual(checks, data);
  assert.equal(verifyProductionState(checks, ["0031_test.sql"]).inFlight, 0);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.executable, process.execPath);
    assert.equal(call.args[0], "C:/Project with spaces/cli.cjs");
    assert.equal(call.options.cwd, "C:/Project with spaces");
    assert.equal(call.options.timeout, 90000);
    const sql = call.args[call.args.indexOf("--command") + 1];
    assert.doesNotMatch(sql, /[\r\n]/);
    assert.match(sql, /^SELECT /);
  }
  const unheld = structuredClone(data);
  unheld[1].results[0].mode = "normal";
  assert.throws(() => verifyProductionState(unheld, ["0031_test.sql"]), /Current mode: normal/);
});

test("preflight preserves the failing check and actual Wrangler error without running later checks", () => {
  let calls = 0;
  const run = () => {
    calls++;
    return calls === 1
      ? { status: 0, stdout: JSON.stringify([result()[0]]) }
      : { status: 1, stderr: "D1_ERROR: no such table: pilot_settings", stdout: "" };
  };
  assert.throws(
    () => readProductionChecks({ cli: "cli", cwd: "root", run }),
    /publishing holds[\s\S]*no such table: pilot_settings/,
  );
  assert.equal(calls, 2);
});

test("preflight reports execution failures, timeouts, malformed JSON and D1 errors", () => {
  for (const [response, message] of [
    [{ error: new Error("spawn ENOENT"), status: null }, /migration list.*spawn ENOENT/],
    [{ error: new Error("spawn ETIMEDOUT"), status: null }, /migration list.*ETIMEDOUT/],
    [{ status: null, signal: "SIGTERM", stderr: "worker terminated" }, /migration list.*SIGTERM/],
    [{ status: 0, stdout: "not JSON" }, /could not parse migration list/],
    [
      {
        status: 0,
        stdout: JSON.stringify([{ success: false, results: [], error: "D1 read failed" }]),
      },
      /SELECT rows.*migration list[\s\S]*D1 read failed/,
    ],
    [
      {
        status: 0,
        stdout: JSON.stringify([
          { success: true, results: [{ "Total queries executed": 3, "Rows written": 0 }] },
        ]),
      },
      /SELECT rows.*migration list/,
    ],
    [{ status: 0, stdout: JSON.stringify(result()) }, /SELECT rows.*migration list/],
  ]) {
    assert.throws(
      () => readProductionChecks({ cli: "cli", cwd: "root", run: () => response }),
      message,
    );
  }
});

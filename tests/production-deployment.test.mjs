import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

function deployment(t) {
  const dir = mkdtempSync(join(tmpdir(), "brandsparq-production-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "checkout");
  mkdirSync(join(root, "scripts/lib"), { recursive: true });
  for (const file of ["deploy-production.mjs", "lib/checkout.mjs"])
    copyFileSync(new URL(`../scripts/${file}`, import.meta.url), join(root, "scripts", file));
  // Orchestration double; real evidence and hosted CI validators have their own tests.
  writeFileSync(
    join(root, "scripts/lib/release-evidence.mjs"),
    `
    export function verifyReleaseEvidence(report, {commit}) {
      if (report.releaseCommit !== commit) throw Error("Evidence commit mismatch");
    }
  `,
  );
  writeFileSync(join(root, "source.txt"), "original");
  const git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  git(["init"]);
  git(["add", "."]);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "fixture"]);
  const commit = git(["rev-parse", "HEAD"]);
  const log = join(dir, "commands.jsonl");
  const cli = join(dir, "npm.cjs");
  writeFileSync(
    cli,
    `
    const fs = require("node:fs");
    const args = process.argv.slice(2);
    const previous = fs.existsSync(process.env.COMMAND_LOG)
      ? fs.readFileSync(process.env.COMMAND_LOG,"utf8").trim().split("\\n").map(JSON.parse) : [];
    fs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify({args,
      api: process.env.EXPO_PUBLIC_API_URL, appEnv: process.env.BRANDSPARQ_APP_ENV,
      fixture: process.env.BRANDSPARQ_E2E_BUILD})+"\\n");
    if (args[1] === "validate" && process.env.MUTATE_SOURCE === "1") fs.appendFileSync("source.txt", "changed");
    if (args[1] === "preflight:production" && process.env.MUTATE_PREFLIGHT === "1" && previous.some(x=>x.args[1]==="validate")) fs.appendFileSync("source.txt", "changed");
    if (args[1] === process.env.FAIL_COMMAND) process.exit(7);
    if (args[1] === "preflight:production" && process.env.HOLD_CHANGED === "1" && previous.some(x=>x.args[1]==="validate")) process.exit(8);
  `,
  );
  const evidence = join(dir, "evidence.json");
  writeFileSync(evidence, JSON.stringify({ releaseCommit: commit }));
  return {
    commit,
    run(extra = {}, args = []) {
      const result = spawnSync(
        process.execPath,
        [join(root, "scripts/deploy-production.mjs"), ...args],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            npm_execpath: cli,
            COMMAND_LOG: log,
            BRANDSPARQ_RELEASE_EVIDENCE: "",
            EXPO_PUBLIC_API_URL: "http://localhost:8788",
            BRANDSPARQ_APP_ENV: "staging",
            BRANDSPARQ_E2E_BUILD: "1",
            ...extra,
          },
        },
      );
      return {
        ...result,
        commands: (() => {
          try {
            return readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
          } catch {
            return [];
          }
        })(),
      };
    },
    evidence,
  };
}

test("held production deploy needs no acceptance file and validates between two live preflights", (t) => {
  const fixture = deployment(t);
  const result = fixture.run({}, ["--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.commands.map((c) => c.args[1]),
    ["preflight:production", "validate", "audit:dependencies", "preflight:production", "--prefix"],
  );
  assert.deepEqual(result.commands[2].args, ["run", "audit:dependencies", "--", "--require-clear"]);
  const upload = result.commands.at(-1);
  assert.ok(upload.args.includes(`RELEASE_COMMIT:${fixture.commit}`));
  assert.ok(upload.args.includes("RELEASE_ACCEPTANCE_COMMIT:held"));
  assert.ok(upload.args.includes("--dry-run"));
  for (const command of result.commands) {
    assert.equal(command.api, "https://brandsparq.getsparqd.com");
    assert.equal(command.appEnv, "production");
    assert.equal(command.fixture, "0");
  }
});

for (const failure of ["preflight:production", "validate", "audit:dependencies"])
  test(`held deployment stops when ${failure} fails`, (t) => {
    const result = deployment(t).run({ FAIL_COMMAND: failure });
    assert.equal(result.status, 7);
    assert.ok(!result.commands.some((c) => c.args.includes("deploy")));
  });

test("a changed hold after validation blocks upload", (t) => {
  const result = deployment(t).run({ HOLD_CHANGED: "1" });
  assert.equal(result.status, 8);
  assert.ok(!result.commands.some((c) => c.args.includes("deploy")));
});

test("source mutations during validation block upload", (t) => {
  const result = deployment(t).run({ MUTATE_SOURCE: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source changed/);
  assert.ok(!result.commands.some((c) => c.args.includes("deploy")));
});

test("source mutations during the final remote preflight block upload", (t) => {
  const result = deployment(t).run({ MUTATE_PREFLIGHT: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source changed/);
  assert.ok(!result.commands.some((c) => c.args.includes("deploy")));
});

test("release status identifies activation scope without certifying a held deployment", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/release-status.mjs", import.meta.url))],
    {
      encoding: "utf8",
      env: { ...process.env, BRANDSPARQ_RELEASE_EVIDENCE: "" },
    },
  );
  assert.equal(result.status, 1, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.scope, "live_activation");
  assert.equal(status.status, "blocked");
  assert.equal(status.heldDeployment.status, "not_checked");
  assert.equal(status.heldDeployment.command, "npm run deploy:production");
});

test("accepted deployment still requires evidence and hosted CI verification", (t) => {
  const result = deployment(t).run({}, ["--accepted"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BRANDSPARQ_RELEASE_EVIDENCE/);
  assert.equal(result.commands.length, 0);
});

test("accepted deployment cannot proceed after release verification fails", (t) => {
  const fixture = deployment(t);
  const result = fixture.run(
    { BRANDSPARQ_RELEASE_EVIDENCE: fixture.evidence, FAIL_COMMAND: "release:verify" },
    ["--accepted"],
  );
  assert.equal(result.status, 7);
  assert.deepEqual(
    result.commands.map((c) => c.args[1]),
    ["release:verify"],
  );
});

test("accepted deployment stamps acceptance only after the full release path", (t) => {
  const fixture = deployment(t);
  const result = fixture.run({ BRANDSPARQ_RELEASE_EVIDENCE: fixture.evidence }, ["--accepted"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.commands[0].args[1], "release:verify");
  assert.deepEqual(result.commands[3].args, ["run", "audit:dependencies", "--", "--release"]);
  assert.ok(result.commands.at(-1).args.includes(`RELEASE_ACCEPTANCE_COMMIT:${fixture.commit}`));
});

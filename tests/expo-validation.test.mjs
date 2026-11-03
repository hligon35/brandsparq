import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
test("Expo validation forces CI mode and propagates failure without installing dependencies", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "brandsparq-expo-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "node_modules/expo/bin"), { recursive: true });
  const source = readFileSync(
    new URL("../scripts/check-expo-dependencies.mjs", import.meta.url),
    "utf8",
  );
  writeFileSync(join(dir, "check.mjs"), source);
  writeFileSync(
    join(dir, "node_modules/expo/bin/cli"),
    `console.log(JSON.stringify({ci:process.env.CI,args:process.argv.slice(2)}));process.exit(17);`,
  );
  const result = spawnSync(process.execPath, [join(dir, "check.mjs")], {
    cwd: dir,
    env: { ...process.env, CI: "0" },
    encoding: "utf8",
  });
  assert.equal(result.status, 17);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.ci, "1");
  assert.deepEqual(output.args, ["install", "--check"]);
});

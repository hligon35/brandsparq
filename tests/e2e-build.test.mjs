import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  buildE2eWeb,
  verifyE2eExport,
  sourceFingerprint,
  E2E_RECEIPT,
} from "../scripts/lib/e2e-build.mjs";
function project(t) {
  const root = mkdtempSync(path.join(tmpdir(), "brandsparq-e2e-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "app"));
  writeFileSync(path.join(root, "app", "index.tsx"), "current app");
  return root;
}
function exporter(root, inspect = () => {}) {
  return (command, args, options) => {
    inspect(command, args, options);
    const out = args.at(-1);
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, "index.html"), readFileSync(path.join(root, "app/index.tsx")));
    return { status: 0 };
  };
}
test("browser startup replaces stale exports and isolates API/configuration across platforms", (t) => {
  const root = project(t);
  mkdirSync(path.join(root, "dist"));
  writeFileSync(path.join(root, "dist/index.html"), "old app");
  const output = buildE2eWeb({
    root,
    environment: {
      EXPO_PUBLIC_API_URL: "https://production.example",
      BRANDSPARQ_APP_ENV: "staging",
      BRANDSPARQ_E2E_BUILD: "1",
    },
    run: exporter(root, (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.ok(args.includes("--clear"));
      assert.equal(options.env.EXPO_NO_DOTENV, "1");
      assert.equal(options.env.EXPO_PUBLIC_API_URL, "");
      assert.equal(options.env.BRANDSPARQ_APP_ENV, "production");
      assert.equal(options.env.BRANDSPARQ_E2E_BUILD, "0");
      assert.equal(options.shell, undefined);
    }),
  });
  assert.equal(readFileSync(path.join(output, "index.html"), "utf8"), "current app");
  assert.equal(readFileSync(path.join(root, "dist/index.html"), "utf8"), "old app");
  assert.equal(verifyE2eExport(root, output).sourceFingerprint, sourceFingerprint(root));
});
test("an old source fingerprint or a configured external API cannot start the fixture", (t) => {
  const root = project(t),
    output = buildE2eWeb({ root, run: exporter(root) });
  writeFileSync(path.join(root, "app/index.tsx"), "newer code");
  assert.throws(() => verifyE2eExport(root, output), /stale/);
  buildE2eWeb({ root, run: exporter(root) });
  const receipt = JSON.parse(readFileSync(path.join(output, E2E_RECEIPT)));
  receipt.apiOrigin = "https://production.example";
  writeFileSync(path.join(output, E2E_RECEIPT), JSON.stringify(receipt));
  assert.throws(() => verifyE2eExport(root, output), /wrong API/);
});
test("failed exports and source edits during compilation stop tests before server startup", (t) => {
  const root = project(t);
  assert.throws(() => buildE2eWeb({ root, run: () => ({ status: 1 }) }), /export failed/);
  assert.throws(
    () =>
      buildE2eWeb({
        root,
        run: exporter(root, () =>
          writeFileSync(path.join(root, "app/index.tsx"), "changed during build"),
        ),
      }),
    /sources changed/,
  );
});

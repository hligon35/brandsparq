import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const E2E_RECEIPT = "brandsparq-e2e-build.json";
export function sourceFingerprint(root) {
  const files = [];
  function visit(relative) {
    const full = path.join(root, relative);
    if (!existsSync(full)) return;
    for (const item of readdirSync(full, { withFileTypes: true })) {
      const name = relative + "/" + item.name;
      if (item.isDirectory()) visit(name);
      else if (item.isFile()) files.push(name);
    }
  }
  for (const dir of ["app", "src", "assets"]) visit(dir);
  for (const file of [
    "app.config.js",
    "app.json",
    "metro.config.js",
    "babel.config.js",
    "tsconfig.json",
    "package.json",
    "package-lock.json",
  ])
    if (existsSync(path.join(root, file))) files.push(file);
  const hash = createHash("sha256");
  for (const file of files.sort())
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(path.join(root, file)))
      .update("\0");
  return hash.digest("hex");
}
export function buildE2eWeb({ root, run = spawnSync, environment = process.env } = {}) {
  const output = path.join(root, ".expo", "e2e-web"),
    fingerprint = sourceFingerprint(root);
  const result = run(
    process.execPath,
    [
      require.resolve("expo/bin/cli"),
      "export",
      "--platform",
      "web",
      "--clear",
      "--output-dir",
      output,
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...environment,
        EXPO_NO_DOTENV: "1",
        EXPO_PUBLIC_API_URL: "",
        BRANDSPARQ_APP_ENV: "production",
        BRANDSPARQ_E2E_BUILD: "0",
      },
    },
  );
  if (result.error || result.status !== 0)
    throw result.error || new Error("Browser fixture export failed; no tests were started.");
  if (sourceFingerprint(root) !== fingerprint)
    throw new Error("App sources changed while exporting. Restart the browser tests.");
  if (!existsSync(path.join(output, "index.html")))
    throw new Error("Browser fixture export did not produce index.html.");
  const receipt = {
    sourceFingerprint: fingerprint,
    apiOrigin: "",
    fixtureBuild: false,
    exportedAt: new Date().toISOString(),
  };
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, E2E_RECEIPT), JSON.stringify(receipt, null, 2) + "\n");
  return output;
}
export function verifyE2eExport(root, output) {
  const receipt = JSON.parse(readFileSync(path.join(output, E2E_RECEIPT), "utf8"));
  if (
    receipt.apiOrigin !== "" ||
    receipt.fixtureBuild !== false ||
    receipt.sourceFingerprint !== sourceFingerprint(root)
  )
    throw new Error(
      "Browser fixture export is stale or uses the wrong API. Run npm run test:e2e to rebuild it.",
    );
  return receipt;
}

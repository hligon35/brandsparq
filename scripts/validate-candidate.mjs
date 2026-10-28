import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Use npm run validate:candidate.");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD"),
  tree = git("rev-parse", "HEAD^{tree}");
if (git("status", "--porcelain"))
  throw new Error("Candidate verification requires a clean committed checkout.");
const receipt = {
  kind: "local-code-validation",
  commit,
  tree,
  startedAt: new Date().toISOString(),
  node: process.version,
  status: "running",
  steps: [],
  operationalAcceptance: false,
};
const steps = [
  ["quality-gate", ["run", "validate"]],
  [
    "ios-javascript",
    [
      "exec",
      "--",
      "expo",
      "export",
      "--platform",
      "ios",
      "--output-dir",
      "test-results/ios-export",
    ],
  ],
  [
    "android-javascript",
    [
      "exec",
      "--",
      "expo",
      "export",
      "--platform",
      "android",
      "--output-dir",
      "test-results/android-export",
    ],
  ],
  [
    "worker-package",
    [
      "exec",
      "--prefix",
      "cloudflare",
      "--",
      "wrangler",
      "deploy",
      "--config",
      "cloudflare/wrangler.toml",
      "--dry-run",
      "--outdir",
      "test-results/worker-package",
    ],
  ],
];
mkdirSync("test-results", { recursive: true });
try {
  for (const [name, args] of steps) {
    const startedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, [npmCli, ...args], {
      stdio: "inherit",
      env: {
        ...process.env,
        EXPO_PUBLIC_API_URL: "",
        BRANDSPARQ_E2E_BUILD: "0",
        BRANDSPARQ_APP_ENV: "production",
      },
    });
    receipt.steps.push({
      name,
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.status,
      status: result.status === 0 && !result.error ? "passed" : "failed",
    });
    if (result.error || result.status !== 0) throw result.error || new Error(`${name} failed.`);
  }
  if (git("rev-parse", "HEAD") !== commit || git("status", "--porcelain"))
    throw new Error("Checkout changed during candidate verification.");
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.error = error.message;
  process.exitCode = 1;
} finally {
  receipt.completedAt = new Date().toISOString();
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/release-candidate.json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
}

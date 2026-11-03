import { verifyCheckout } from "./lib/checkout.mjs";
import { readFileSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const accepted = process.argv.includes("--accepted");
const unknown = process.argv.slice(2).filter((arg) => !["--accepted", "--dry-run"].includes(arg));
if (unknown.length) throw new Error(`Unknown deployment option: ${unknown.join(", ")}`);
const evidenceFile = process.env.BRANDSPARQ_RELEASE_EVIDENCE;
if (accepted && !evidenceFile)
  throw new Error(
    "Set BRANDSPARQ_RELEASE_EVIDENCE to the completed private release evidence JSON. See docs/RELEASE_ACCEPTANCE.md.",
  );
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim())
  throw new Error("Production deployment requires a clean checkout of the source commit.");
if (accepted) {
  const { verifyReleaseEvidence } = await import("./lib/release-evidence.mjs");
  verifyReleaseEvidence(JSON.parse(readFileSync(evidenceFile, "utf8")), { commit });
}
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Use npm run deploy:production.");
// Production assets must be built against the production API. Never inherit a
// staging/loopback public URL or fixture-only native networking configuration.
const env = {
  ...process.env,
  EXPO_PUBLIC_API_URL: "https://brandsparq.getsparqd.com",
  BRANDSPARQ_APP_ENV: "production",
  BRANDSPARQ_E2E_BUILD: "0",
};
console.log(
  accepted
    ? "Deploying an accepted release. Publishing remains held until owner pilot activation."
    : "Deploying with publishing held. Live acceptance is not required or marked passed.",
);
for (const args of [
  ...(accepted ? [["run", "release:verify"]] : []),
  ["run", "preflight:production"],
  ["run", "validate"],
  ["run", "audit:dependencies", "--", accepted ? "--release" : "--require-clear"],
  ["run", "preflight:production"],
  [
    "exec",
    "--prefix",
    "cloudflare",
    "--",
    "wrangler",
    "deploy",
    "--config",
    "cloudflare/wrangler.toml",
    "--var",
    `RELEASE_COMMIT:${commit}`,
    "--var",
    `RELEASE_ACCEPTANCE_COMMIT:${accepted ? commit : "held"}`,
    ...(process.argv.includes("--dry-run") ? ["--dry-run"] : []),
  ],
]) {
  // Check source both before the final remote preflight and after it.
  if (args.includes("deploy") || args[1] === "preflight:production") verifyCheckout(commit, root);
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}

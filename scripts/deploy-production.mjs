import { readFileSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyReleaseEvidence } from "./lib/release-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidenceFile = process.env.BRANDSPARQ_RELEASE_EVIDENCE;
if (!evidenceFile)
  throw new Error(
    "Set BRANDSPARQ_RELEASE_EVIDENCE to the completed private release evidence JSON. See docs/RELEASE_ACCEPTANCE.md.",
  );
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim())
  throw new Error("Production deployment requires a clean checkout of the accepted commit.");
verifyReleaseEvidence(JSON.parse(readFileSync(evidenceFile, "utf8")), { commit });
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
for (const args of [
  ["run", "release:verify"],
  ["run", "validate"],
  ["run", "audit:dependencies", "--", "--release"],
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
    ...(process.argv.includes("--dry-run") ? ["--dry-run"] : []),
  ],
]) {
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

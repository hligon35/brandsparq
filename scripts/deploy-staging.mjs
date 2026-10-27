import { spawnSync, execFileSync } from "node:child_process";
import "./staging-config.mjs";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this command with npm run deploy:staging.");
// An inherited production API override must never enter the staging web bundle.
// Empty means same-origin on web and also lets the isolated browser fixture run.
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
  throw new Error(
    "Staging deployment requires a clean checkout so acceptance matches its source commit.",
  );
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const env = { ...process.env, EXPO_PUBLIC_API_URL: "" };
for (const args of [
  ["run", "validate"],
  ["--prefix", "cloudflare", "run", "deploy:staging", "--", "--var", `RELEASE_COMMIT:${commit}`],
]) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}

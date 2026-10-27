import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Use npm run build:cloudflare.");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (process.env.WORKERS_CI_COMMIT_SHA && process.env.WORKERS_CI_COMMIT_SHA !== commit)
  throw new Error("Cloudflare build metadata does not match the checked-out commit.");
if (![undefined, "production", "staging"].includes(process.env.BRANDSPARQ_APP_ENV))
  throw new Error("Cloudflare compilation requires production or staging app configuration.");
const staging = process.env.BRANDSPARQ_APP_ENV === "staging";
const api = staging ? process.env.BRANDSPARQ_STAGING_ORIGIN : "https://brandsparq.getsparqd.com";
if (staging && !/^https:\/\/brandsparq-staging\.[a-z0-9-]+\.workers\.dev$/.test(api || ""))
  throw new Error("Staging compilation requires its isolated HTTPS origin.");
// Compilation never publishes or migrates. Deployment still uses the guarded
// production command or the separately configured, isolated staging Worker.
for (const args of [
  ["ci", "--prefix", "cloudflare"],
  ["run", "build:web"],
]) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: root,
    env: {
      ...process.env,
      EXPO_PUBLIC_API_URL: api,
      BRANDSPARQ_E2E_BUILD: "0",
      BRANDSPARQ_APP_ENV: staging ? "staging" : "production",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}

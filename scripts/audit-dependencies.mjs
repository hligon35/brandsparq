import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { assessAudit } from "./lib/dependency-disposition.mjs";
import { verifyReleaseEvidence } from "./lib/release-evidence.mjs";
import { execFileSync } from "node:child_process";
const release = process.argv.includes("--release");
let ownerDisposition;
if (release) {
  if (!process.env.BRANDSPARQ_RELEASE_EVIDENCE) throw new Error("Release evidence is required.");
  const report = JSON.parse(readFileSync(process.env.BRANDSPARQ_RELEASE_EVIDENCE, "utf8"));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  verifyReleaseEvidence(report, { commit });
  ownerDisposition = report.gates.advisories;
}
if (!process.env.npm_execpath) throw new Error("Use npm run audit:dependencies.");
for (const directory of [".", "cloudflare"]) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, "audit", "--json"], {
    cwd: directory,
    encoding: "utf8",
  });
  if (result.error || ![0, 1].includes(result.status))
    throw new Error(`Audit failed for ${directory}.`);
  const report = JSON.parse(result.stdout);
  const lock = JSON.parse(readFileSync(`${directory}/package-lock.json`, "utf8"));
  const disposition = assessAudit(report, lock, { release, disposition: ownerDisposition });
  if (directory === "cloudflare" && !disposition.securityClear)
    throw new Error("Worker tooling must have a clean audit.");
  console.log(directory, JSON.stringify(disposition));
}

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { RELEASE_GATES, verifyReleaseEvidence } from "./lib/release-evidence.mjs";
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const path = process.env.BRANDSPARQ_RELEASE_EVIDENCE;
let report, error;
try {
  if (!path || !existsSync(path)) throw new Error("No completed release evidence file supplied.");
  report = JSON.parse(readFileSync(path, "utf8"));
  verifyReleaseEvidence(report, { commit });
} catch (e) {
  error = e.message;
}
console.log(
  JSON.stringify(
    {
      releaseCommit: commit,
      status: error ? "blocked" : "attested_pending_live_ci_verification",
      reason: error || null,
      gates: RELEASE_GATES.map((name) => ({
        name,
        status: report?.gates?.[name]?.status || "blocked",
        commitMatches: report?.gates?.[name]?.releaseCommit === commit,
      })),
      nextCommand: "npm run release:verify",
    },
    null,
    2,
  ),
);
if (error) process.exitCode = 1;

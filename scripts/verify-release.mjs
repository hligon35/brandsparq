import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { verifyReleaseEvidence } from "./lib/release-evidence.mjs";
import { verifyHostedCI } from "./lib/acceptance-matrix.mjs";
const path = process.env.BRANDSPARQ_RELEASE_EVIDENCE;
if (!path)
  throw new Error("Set BRANDSPARQ_RELEASE_EVIDENCE to the completed private release report.");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const report = JSON.parse(readFileSync(path, "utf8"));
const acceptance = verifyReleaseEvidence(report, { commit });
const ci = await verifyHostedCI(report.gates.ci, commit);
console.log(JSON.stringify({ ...acceptance, ci }));

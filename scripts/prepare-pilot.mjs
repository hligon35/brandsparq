import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { verifyReleaseEvidence } from "./lib/release-evidence.mjs";
import { verifyHostedCI } from "./lib/acceptance-matrix.mjs";
import { preparePilotPlan } from "./lib/pilot-plan.mjs";
const path = process.env.BRANDSPARQ_RELEASE_EVIDENCE;
if (!path) throw new Error("Set BRANDSPARQ_RELEASE_EVIDENCE to the completed release report.");
const report = JSON.parse(readFileSync(path, "utf8")),
  commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
verifyReleaseEvidence(report, { commit });
await verifyHostedCI(report.gates.ci, commit);
const url = new URL(process.env.BRANDSPARQ_PILOT_ORIGIN || "");
if (
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/" ||
  !["https://brandsparq.getsparqd.com", report.stagingOrigin].includes(url.origin)
)
  throw new Error("Use only production or the accepted isolated staging origin.");
const token = process.env.BRANDSPARQ_OWNER_TOKEN;
if (!token) throw new Error("Set the owner session token privately in BRANDSPARQ_OWNER_TOKEN.");
const response = await fetch(`${url.origin}/v1/system/pilot`, {
  headers: { authorization: `Bearer ${token}` },
  redirect: "error",
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw new Error("Cannot read owner pilot controls. No activation was performed.");
const { data } = await response.json();
const plan = preparePilotPlan(report, {
  commit,
  pilot: data,
  clientId: process.env.BRANDSPARQ_PILOT_CLIENT_ID,
  socialAccountId: process.env.BRANDSPARQ_PILOT_DESTINATION_ID,
  endsAt: process.env.BRANDSPARQ_PILOT_ENDS_AT,
});
console.log(
  JSON.stringify(
    {
      status: "prepared_not_activated",
      holds: {
        workspace: "hold",
        client: "hold",
        ownerSupervision: true,
        maxExecutionsPerClientPerUtcDay: 1,
      },
      payload: plan,
    },
    null,
    2,
  ),
);

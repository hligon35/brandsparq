import { verifyReleaseEvidence } from "./release-evidence.mjs";
export function preparePilotPlan(
  report,
  { commit, pilot, clientId, socialAccountId, endsAt, now = Date.now() },
) {
  verifyReleaseEvidence(report, { commit, now });
  if (
    pilot?.mode !== "hold" ||
    pilot.deployedCommit !== commit ||
    pilot.inFlight !== 0 ||
    !Number.isSafeInteger(pilot.revision)
  )
    throw new Error(
      "Pilot preparation requires a matching deployed release, current hold and no in-flight publication.",
    );
  const accepted = report.gates.providers.accepted.some((name) => {
    const result = report.gates.providers.results[name];
    return result.clientId === clientId && result.socialAccountId === socialAccountId;
  });
  if (
    !accepted ||
    !pilot.availableDestinations?.some(
      (item) => item.clientId === clientId && item.socialAccountId === socialAccountId,
    )
  )
    throw new Error("Choose the exact active destination that passed provider acceptance.");
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end) || end <= now || end > now + 7 * 86400000)
    throw new Error("Pilot expiry must be in the next seven days.");
  return {
    mode: "supervised",
    expectedRevision: pilot.revision,
    releaseCommit: commit,
    endsAt: new Date(end).toISOString(),
    destinations: [{ clientId, socialAccountId }],
    evidence: Object.fromEntries(
      Object.entries(report.gates).map(([name, gate]) => [name, gate.evidenceUrl]),
    ),
  };
}

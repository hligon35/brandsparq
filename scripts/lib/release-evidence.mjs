export const RELEASE_GATES = [
  "ci",
  "staging",
  "routing",
  "providers",
  "restore",
  "android",
  "ios",
  "advisories",
];

export function verifyReleaseEvidence(report, { commit, now = Date.now() }) {
  if (!report || report.releaseCommit !== commit || !/^[a-f0-9]{40}$/.test(commit || ""))
    throw new Error("Release evidence must identify the exact checked-out commit.");
  if (report.operator?.trim?.().length < 3 || typeof report.operator !== "string")
    throw new Error("Record the responsible release operator.");
  const captured = Date.parse(report.recordedAt);
  if (!Number.isFinite(captured) || captured > now || now - captured > 7 * 86400000)
    throw new Error("Release evidence must be recorded within the last seven days.");
  for (const name of RELEASE_GATES) {
    const gate = report.gates?.[name];
    if (gate?.status !== "passed" || gate.releaseCommit !== commit)
      throw new Error(`Release blocked: ${name} has not passed for this commit.`);
    let url;
    try {
      url = new URL(gate.evidenceUrl);
    } catch {
      throw new Error(`Missing evidence URL: ${name}`);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /^(localhost|127\.|\[::1\])/.test(url.hostname)
    )
      throw new Error(`Use a stable private HTTPS evidence reference for ${name}.`);
    if (typeof gate.summary !== "string" || gate.summary.trim().length < 10)
      throw new Error(`Record the acceptance result for ${name}.`);
  }
  if (!/^https:\/\/brandsparq-staging\.[a-z0-9-]+\.workers\.dev$/.test(report.stagingOrigin || ""))
    throw new Error("Record the isolated staging origin.");
  for (const platform of ["android", "ios"]) {
    const device = report.gates[platform];
    if (!device.physicalDevice || !device.buildId || !device.osVersion || !device.device)
      throw new Error(`Record physical device, OS and build ID for ${platform}.`);
  }
  const restore = report.gates.restore;
  if (
    !restore.backupId ||
    !/^[0-9a-f-]{36}$/.test(restore.restoreDatabaseId || "") ||
    restore.restoreDatabaseId === "1f6f0d67-1725-4f19-8fd9-0f80f600f5b1" ||
    !/^brandsparq-restore-[a-z0-9-]+$/.test(restore.restoreBucket || "") ||
    !Number.isFinite(restore.elapsedSeconds) ||
    restore.elapsedSeconds <= 0 ||
    restore.mediaChecksumsVerified !== true ||
    restore.tokenDecryptionVerified !== true
  )
    throw new Error(
      "Record an actual isolated D1/R2 restore, elapsed time, checksums and decryption result.",
    );
  if (report.gates.ci.conclusion !== "success") throw new Error("CI must conclude success.");
  if (report.gates.routing.anonymous !== true)
    throw new Error("Access acceptance requires anonymous probes.");
  if (
    !Array.isArray(report.gates.providers.accepted) ||
    !report.gates.providers.accepted.length ||
    report.gates.providers.accepted.some(
      (provider) => !["facebook", "instagram", "linkedin", "tiktok", "x"].includes(provider),
    )
  )
    throw new Error("Record the provider scope that actually passed acceptance.");
  if (report.gates.advisories.ownerAccepted !== true)
    throw new Error("Dependency disposition requires the release owner's recorded decision.");
  return {
    releaseCommit: commit,
    operator: report.operator,
    gates: RELEASE_GATES,
    status: "attested",
  };
}

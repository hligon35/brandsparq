import { RELEASE_GATES } from "../../scripts/lib/release-evidence.mjs";
import { DEVICE_CHECKS, PROVIDER_CHECKS } from "../../scripts/lib/acceptance-matrix.mjs";
export function accepted() {
  const releaseCommit = "a".repeat(40);
  const report = {
    releaseCommit,
    operator: "Test operator",
    recordedAt: new Date().toISOString(),
    stagingOrigin: "https://brandsparq-staging.test.workers.dev",
    gates: Object.fromEntries(
      RELEASE_GATES.map((name) => [
        name,
        {
          releaseCommit,
          status: "passed",
          evidenceUrl: `https://evidence.example.test/${name}`,
          summary: "Test acceptance evidence",
          conclusion: "success",
          anonymous: true,
          physicalDevice: true,
          device: "Test device",
          osVersion: "Test OS",
          buildId: "test-build",
          backupId: "test-backup",
          restoreDatabaseId: "00000000-0000-4000-8000-000000000001",
          restoreBucket: "brandsparq-restore-test",
          elapsedSeconds: 10,
          mediaChecksumsVerified: true,
          tokenDecryptionVerified: true,
          accepted: ["facebook"],
          ownerAccepted: true,
        },
      ]),
    ),
  };
  report.attestationVersion = 2;
  report.gates.ci.runId = 123;
  const check = () => ({
    status: "passed",
    recordedAt: new Date().toISOString(),
    evidenceUrl: "https://evidence.example.test/acceptance",
    summary: "Isolated test acceptance result",
  });
  for (const platform of ["android", "ios"])
    Object.assign(report.gates[platform], {
      buildProfile: "staging",
      channel: "staging",
      runtimeVersion: "0.1.1",
      apiOrigin: report.stagingOrigin,
      fixtureBuild: false,
      checks: Object.fromEntries(DEVICE_CHECKS.map((name) => [name, check()])),
    });
  report.gates.providers.results = {
    facebook: {
      clientId: "client",
      socialAccountId: "destination",
      providerPostId: "receipt",
      providerPostUrl: "https://facebook.com/receipt",
      checks: Object.fromEntries(PROVIDER_CHECKS.map((name) => [name, check()])),
    },
  };
  Object.assign(report.gates.restore, {
    disconnected: true,
    liveSessionsRevoked: true,
    sqlSha256: "a".repeat(64),
    inventorySha256: "b".repeat(64),
    mediaObjects: 1,
    missingObjects: 0,
    corruptObjects: 0,
    foreignKeysVerified: true,
  });
  return report;
}

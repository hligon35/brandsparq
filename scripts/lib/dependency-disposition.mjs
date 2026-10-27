export function assessAudit(
  report,
  lock,
  { release = false, now = Date.now(), ownerAccepted = false } = {},
) {
  if (report.error || !report.metadata?.vulnerabilities || !report.vulnerabilities)
    throw new Error("Dependency audit did not return a complete report.");
  const tracked = {
    "GHSA-mrhx-c7xc-m3w5": { package: "zod", version: "3.25.76" },
  };
  const unresolved = new Set();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const issue of vulnerability.via) {
      if (typeof issue === "string") continue;
      const id = issue.url?.split("/").at(-1);
      const known = tracked[id];
      if (
        !known ||
        known.package !== vulnerability.name ||
        vulnerability.nodes.some((node) => lock.packages[node]?.version !== known.version)
      )
        throw new Error(`Unreviewed dependency advisory: ${issue.url || vulnerability.name}`);
      unresolved.add(id);
    }
  }
  if (unresolved.size && now >= Date.parse("2026-11-08T00:00:00Z"))
    throw new Error("Dependency dispositions expired; refresh the upstream review.");
  if (release && unresolved.size && !ownerAccepted)
    throw new Error(
      "Remaining build/signing advisories require the release owner's evidence-backed disposition.",
    );
  return {
    vulnerabilities: report.metadata.vulnerabilities,
    trackedAdvisories: [...unresolved],
    securityClear: unresolved.size === 0,
  };
}

const tracked = {
  "GHSA-gcqx-w48m-w2h4": {
    package: "deepmerge",
    version: "4.3.1",
    expiresAt: "2026-11-08T00:00:00Z",
  },
  "GHSA-mrhx-c7xc-m3w5": { package: "zod", version: "3.25.76", expiresAt: "2026-11-08T00:00:00Z" },
};

export function requiredDispositions(lock, { remediated = [] } = {}) {
  return Object.entries(tracked)
    .filter(([id, item]) => {
      const affected = Object.entries(lock.packages || {}).filter(
        ([path, value]) => path.endsWith(`/${item.package}`) && value.version === item.version,
      );
      return (
        affected.length &&
        !(
          remediated.includes(id) &&
          affected.every(([path]) => path === `node_modules/${item.package}`)
        )
      );
    })
    .map(([id]) => id);
}

export function verifyAdvisoryDispositions(gate, ids, { now = Date.now() } = {}) {
  const rows = gate?.dispositions;
  if (gate?.ownerAccepted !== true || !Array.isArray(rows) || rows.length !== ids.length)
    throw new Error(
      "Record the owner's explicit disposition for every unresolved dependency advisory.",
    );
  for (const id of ids) {
    const matches = rows.filter((row) => row.advisoryId === id);
    const row = matches[0],
      known = tracked[id];
    const recorded = Date.parse(row?.recordedAt),
      next = Date.parse(row?.nextReviewAt);
    if (
      !known ||
      matches.length !== 1 ||
      row.package !== known.package ||
      row.version !== known.version ||
      row.decision !== "accepted" ||
      typeof row.approvedBy !== "string" ||
      row.approvedBy.trim().length < 3 ||
      !Array.isArray(row.mitigations) ||
      !row.mitigations.length ||
      row.mitigations.some((text) => typeof text !== "string" || text.trim().length < 10) ||
      !Number.isFinite(recorded) ||
      recorded > now ||
      now - recorded > 7 * 86400000 ||
      !Number.isFinite(next) ||
      next <= now ||
      next > now + 7 * 86400000 ||
      next > Date.parse(known.expiresAt)
    )
      throw new Error(
        `Record a current owner decision, exact version, mitigations and next review for ${id}.`,
      );
  }
}

export function assessAudit(
  report,
  lock,
  { release = false, now = Date.now(), disposition, remediated = [] } = {},
) {
  if (report.error || !report.metadata?.vulnerabilities || !report.vulnerabilities)
    throw new Error("Dependency audit did not return a complete report.");
  const totals = report.metadata.vulnerabilities;
  const levels = ["info", "low", "moderate", "high", "critical"];
  if (
    [...levels, "total"].some((name) => !Number.isSafeInteger(totals[name]) || totals[name] < 0) ||
    levels.reduce((sum, name) => sum + totals[name], 0) !== totals.total
  )
    throw new Error("Dependency audit did not return complete, consistent vulnerability totals.");
  const unresolved = new Set(),
    observed = new Set(),
    patched = new Set();
  function verifyChain(name, parents = new Set()) {
    const node = report.vulnerabilities[name];
    if (!node || !Array.isArray(node.via) || !node.via.length || parents.has(name))
      throw new Error("Dependency audit contains an incomplete advisory chain.");
    const next = new Set([...parents, name]);
    for (const issue of node.via) if (typeof issue === "string") verifyChain(issue, next);
  }
  for (const name of Object.keys(report.vulnerabilities)) verifyChain(name);
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const issue of vulnerability.via) {
      if (typeof issue === "string") continue;
      const id = issue.url?.split("/").at(-1);
      const known = tracked[id];
      if (
        !known ||
        known.package !== vulnerability.name ||
        !Array.isArray(vulnerability.nodes) ||
        !vulnerability.nodes.length ||
        vulnerability.nodes.some((node) => lock.packages[node]?.version !== known.version)
      )
        throw new Error(`Unreviewed dependency advisory: ${issue.url || vulnerability.name}`);
      observed.add(id);
      if (
        remediated.includes(id) &&
        vulnerability.nodes.every((node) => node === `node_modules/${known.package}`)
      ) {
        patched.add(id);
        continue;
      }
      // A new advisory still requires review; listing a name is never a global exemption.
      unresolved.add(id);
    }
  }
  if (
    (totals.total > 0 && !observed.size) ||
    (totals.total === 0 && Object.keys(report.vulnerabilities).length)
  )
    throw new Error("Dependency audit findings do not match the reviewed advisory graph.");
  if (unresolved.size && now >= Date.parse("2026-11-08T00:00:00Z"))
    throw new Error("Dependency dispositions expired; refresh the upstream review.");
  if (release && unresolved.size) verifyAdvisoryDispositions(disposition, [...unresolved], { now });
  return {
    vulnerabilities: report.metadata.vulnerabilities,
    trackedAdvisories: [...unresolved],
    locallyRemediated: [...patched],
    securityClear: unresolved.size === 0,
  };
}

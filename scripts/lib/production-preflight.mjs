export const UNRESOLVED_PUBLISHING_SQL = `SELECT COUNT(*) AS in_flight FROM posts p
  WHERE p.status IN ('publishing','provider_processing')
    OR p.failure_code='PUBLISH_OUTCOME_UNKNOWN'
    OR EXISTS(SELECT 1 FROM publish_jobs j WHERE j.post_id=p.id AND j.status='publishing')`;

export function verifyProductionState(results, migrations) {
  if (
    !Array.isArray(results) ||
    results.length !== 3 ||
    results.some((row) => row.success !== true || !Array.isArray(row.results))
  )
    throw new Error("Production preflight did not return the expected D1 checks.");
  const applied = new Set(results[0].results.map((row) => row.name));
  const missing = migrations.filter((name) => !applied.has(name));
  if (missing.length)
    throw new Error(`Apply pending production migrations before deploying: ${missing.join(", ")}`);
  const settings = results[1].results[0];
  if (settings?.mode !== "hold" || settings?.no_response_policy !== "hold")
    throw new Error("Hold publishing and choose no-response policy hold before deployment.");
  if (results[2].results[0]?.in_flight !== 0)
    throw new Error(
      "Reconcile all in-flight publishing, pending provider confirmations and unknown outcomes before deployment.",
    );
  return {
    migrations: migrations.length,
    pilotMode: "hold",
    noResponsePolicy: "hold",
    inFlight: 0,
  };
}

export function parseWranglerD1Output(stdout) {
  const text = stdout
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/^\uFEFF/, "")
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    /* Some Wrangler versions print banners around JSON. */
  }
  const candidates = [];
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "[") continue;
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let end = start; end < text.length; end++) {
      const char = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "[") depth++;
      else if (char === "]" && --depth === 0) {
        try {
          const value = JSON.parse(text.slice(start, end + 1));
          if (
            Array.isArray(value) &&
            value.length === 3 &&
            value.every(
              (row) => row && typeof row.success === "boolean" && Array.isArray(row.results),
            )
          ) {
            candidates.push(value);
            start = end;
          }
        } catch {
          /* Banner brackets are not JSON results. */
        }
        break;
      }
    }
  }
  if (candidates.length !== 1)
    throw new Error(
      "Wrangler did not return one unambiguous D1 preflight result. Check Wrangler authentication and query output.",
    );
  return candidates[0];
}

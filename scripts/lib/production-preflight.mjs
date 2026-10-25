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
    throw new Error("Reconcile all in-flight publishing before deployment.");
  return {
    migrations: migrations.length,
    pilotMode: "hold",
    noResponsePolicy: "hold",
    inFlight: 0,
  };
}

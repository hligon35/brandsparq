import { runProductionSmoke } from "./lib/production-smoke.mjs";

try {
  if ((await runProductionSmoke()).length) process.exitCode = 1;
} catch (error) {
  console.error(
    "Production smoke test FAILED:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
}

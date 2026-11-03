import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Validation must never launch an installer or modify the accepted source tree.
const result = spawnSync(
  process.execPath,
  [require.resolve("expo/bin/cli"), "install", "--check"],
  {
    env: { ...process.env, CI: "1" },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

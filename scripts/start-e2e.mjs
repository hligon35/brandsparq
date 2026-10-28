import { fileURLToPath } from "node:url";
import { buildE2eWeb } from "./lib/e2e-build.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
process.env.BRANDSPARQ_TEST_WEB_ROOT = buildE2eWeb({ root });
await import("../tests/e2e/server.mjs");

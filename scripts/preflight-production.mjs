import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readdirSync } from "node:fs";
import { verifyProductionState, readProductionChecks } from "./lib/production-preflight.mjs";
if (!process.env.npm_execpath) throw new Error("Use npm run preflight:production.");
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../cloudflare/package.json", import.meta.url));
const manifestPath = require.resolve("wrangler/package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.wrangler;
const cli = path.resolve(path.dirname(manifestPath), bin);
const results = readProductionChecks({ cli, cwd: root });
const migrations = readdirSync(path.join(root, "cloudflare/migrations"))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
console.log(JSON.stringify(verifyProductionState(results, migrations)));

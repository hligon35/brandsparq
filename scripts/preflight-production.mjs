import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import {
  verifyProductionState,
  parseWranglerD1Output,
  UNRESOLVED_PUBLISHING_SQL,
} from "./lib/production-preflight.mjs";
if (!process.env.npm_execpath) throw new Error("Use npm run preflight:production.");
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../cloudflare/package.json", import.meta.url));
const manifestPath = require.resolve("wrangler/package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.wrangler;
const cli = path.resolve(path.dirname(manifestPath), bin);
const sql = `SELECT name FROM d1_migrations;
SELECT cfg.mode,ws.default_no_response_policy AS no_response_policy FROM pilot_settings cfg JOIN workspace_settings ws ON ws.id=cfg.id WHERE cfg.id='default';
${UNRESOLVED_PUBLISHING_SQL};`;
const result = spawnSync(
  process.execPath,
  [
    cli,
    "d1",
    "execute",
    "brandsparq",
    "--remote",
    "--config",
    "cloudflare/wrangler.toml",
    "--command",
    sql,
    "--json",
  ],
  { cwd: root, encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
);
if (result.error || result.status !== 0)
  throw new Error(
    "Could not read production deployment state. Authenticate Wrangler and apply migrations first.",
  );
const migrations = readdirSync(path.join(root, "cloudflare/migrations"))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
console.log(
  JSON.stringify(verifyProductionState(parseWranglerD1Output(result.stdout), migrations)),
);

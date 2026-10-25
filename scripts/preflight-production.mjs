import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { verifyProductionState } from "./lib/production-preflight.mjs";
if (!process.env.npm_execpath) throw new Error("Use npm run preflight:production.");
const sql = `SELECT name FROM d1_migrations;
SELECT cfg.mode,ws.default_no_response_policy AS no_response_policy FROM pilot_settings cfg JOIN workspace_settings ws ON ws.id=cfg.id WHERE cfg.id='default';
SELECT COUNT(*) AS in_flight FROM publish_jobs WHERE status='publishing';`;
const result = spawnSync(
  process.execPath,
  [
    process.env.npm_execpath,
    "exec",
    "--prefix",
    "cloudflare",
    "--",
    "wrangler",
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
  { encoding: "utf8" },
);
if (result.error || result.status !== 0)
  throw new Error(
    "Could not read production deployment state. Authenticate Wrangler and apply migrations first.",
  );
const migrations = readdirSync("cloudflare/migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
console.log(JSON.stringify(verifyProductionState(JSON.parse(result.stdout), migrations)));

import { readFileSync, writeFileSync } from "node:fs";
const origin = process.env.BRANDSPARQ_STAGING_ORIGIN || "";
const database = (process.env.BRANDSPARQ_STAGING_DATABASE_ID || "").trim().toLowerCase();
const googleClient = process.env.BRANDSPARQ_STAGING_GOOGLE_CLIENT_ID || "";
if (!/^https:\/\/brandsparq-staging\.[a-z0-9-]+\.workers\.dev$/.test(origin))
  throw new Error(
    "Set BRANDSPARQ_STAGING_ORIGIN to the verified brandsparq-staging workers.dev origin.",
  );
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(database) ||
  database === "1f6f0d67-1725-4f19-8fd9-0f80f600f5b1"
)
  throw new Error("Set a separate staging D1 UUID. Production is forbidden.");
if (
  !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.apps\.googleusercontent\.com$/.test(googleClient) ||
  googleClient === "1096231725383-7lrjdhj0p4gp8ipbi6228tf03dhg5jqe.apps.googleusercontent.com"
)
  throw new Error("Set a separate staging Google OAuth client ID.");
// Derive shared runtime settings from the authoritative production config;
// replace every resource and origin, with no production custom-domain route.
const source = readFileSync("cloudflare/wrangler.toml", "utf8");
const allowedSections = new Set([
  "vars",
  "assets",
  "d1_databases",
  "r2_buckets",
  "queues.producers",
  "queues.consumers",
  "triggers",
  "observability.logs",
  "observability.traces",
  "observability.issue_detection",
]);
const sections = [...source.matchAll(/^\s*\[{1,2}([a-z0-9_.]+)\]{1,2}\s*$/gm)].map(
  (match) => match[1],
);
if (
  sections.some((section) => !allowedSections.has(section)) ||
  sections.filter((section) => section === "d1_databases").length !== 1 ||
  sections.filter((section) => section === "r2_buckets").length !== 1 ||
  sections.filter((section) => section === "queues.producers").length !== 2 ||
  sections.filter((section) => section === "queues.consumers").length !== 2
) {
  throw new Error(
    "Production resource layout changed. Add explicit staging isolation rules before deployment.",
  );
}
let config = source
  .replace(/^name = "brandsparq"/m, 'name = "brandsparq-staging"')
  .replace(/routes = \[[\s\S]*?\]/, "workers_dev = true")
  .replace('ENVIRONMENT = "production"', 'ENVIRONMENT = "staging"')
  .replace(/https:\/\/brandsparq\.getsparqd\.com/g, origin)
  .replace(/GOOGLE_CLIENT_ID = "[^"]+"/, `GOOGLE_CLIENT_ID = "${googleClient}"`)
  .replace(/database_id = "[^"]+"/, `database_id = "${database}"`)
  .replace('database_name = "brandsparq"', 'database_name = "brandsparq-staging"')
  .replace(/"brandsparq-(media|publish|generation)(-dlq)?"/g, '"brandsparq-staging-$1$2"');
if (
  /brandsparq\.getsparqd\.com|1f6f0d67-1725-4f19-8fd9-0f80f600f5b1|"brandsparq-(?:media|publish|generation)/.test(
    config,
  )
)
  throw new Error("Staging isolation check failed.");
writeFileSync("cloudflare/wrangler.staging.toml", config);
console.log(
  "Staging configuration generated; resource creation and secret provisioning remain explicit.",
);

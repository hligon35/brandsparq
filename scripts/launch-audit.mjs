import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);

const requiredFiles = [
  "app.json",
  "eas.json",
  "assets/brandsparqFavicon.png",
  "assets/brandsparqIcon.png",
  "assets/brandsparqLogo.png",
  "cloudflare/wrangler.toml",
  "cloudflare/migrations/0015_sprint7_production_hardening.sql",
  "cloudflare/migrations/0016_sprint8_launch_certification.sql",
  "docs/PRODUCTION.md",
];
for (const file of requiredFiles) if (!exists(file)) fail(`Missing required release file: ${file}`);

const wrangler = read("cloudflare/wrangler.toml");
const requiredWrangler = [
  'name = "brandsparq"',
  'ENVIRONMENT = "production"',
  'PUBLIC_BASE_URL = "https://brandsparq.getsparqd.com"',
  'GOOGLE_REDIRECT_URI = "https://brandsparq.getsparqd.com/v1/auth/google/callback"',
  'database_name = "brandsparq"',
  'bucket_name = "brandsparq-media"',
  'queue = "brandsparq-publish"',
  'queue = "brandsparq-generation"',
  'dead_letter_queue = "brandsparq-publish-dlq"',
  'dead_letter_queue = "brandsparq-generation-dlq"',
];
for (const value of requiredWrangler)
  if (!wrangler.includes(value)) fail(`wrangler.toml missing production setting: ${value}`);
if (/REPLACE_WITH|YOUR_|CHANGEME|example\.com/i.test(wrangler))
  fail("wrangler.toml contains a placeholder production value.");
if (!/database_id\s*=\s*"[0-9a-f-]{36}"/i.test(wrangler))
  fail("Production D1 database_id is missing or malformed.");

const app = JSON.parse(read("app.json"));
if (app.expo?.scheme !== "brandsparq") fail("Expo scheme must be brandsparq.");
if (app.expo?.web?.output !== "single")
  fail("Expo web output must remain single-page for Worker asset routing.");
if (!app.expo?.icon || !exists(app.expo.icon.replace(/^\.\//, "")))
  fail("Expo app icon is missing.");
if (!app.expo?.web?.favicon || !exists(app.expo.web.favicon.replace(/^\.\//, "")))
  fail("Expo favicon is missing.");
if (!app.expo?.extra?.eas?.projectId)
  warn(
    "EAS projectId is not linked yet; native push/release setup remains incomplete until eas init.",
  );

const api = read("src/api/client.ts");
if (!api.includes("https://brandsparq.getsparqd.com"))
  fail("Native production API fallback is not configured.");
if (!api.includes("__DEV__"))
  fail("Native API fallback does not distinguish development from production.");

const migrations = fs
  .readdirSync(path.join(root, "cloudflare/migrations"))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const numbers = migrations.map((name) => Number(name.slice(0, 4)));
for (let i = 1; i < numbers.length; i++) {
  if (numbers[i] !== numbers[i - 1] + 1)
    fail(`Migration sequence gap between ${migrations[i - 1]} and ${migrations[i]}.`);
}
const duplicate = new Set();
for (const n of numbers) {
  if (duplicate.has(n)) fail(`Duplicate migration number: ${String(n).padStart(4, "0")}`);
  duplicate.add(n);
}

const sourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|mjs|toml)$/.test(entry.name)) sourceFiles.push(full);
  }
}
for (const dir of ["app", "src", "cloudflare/src"]) if (exists(dir)) walk(path.join(root, dir));
for (const full of sourceFiles) {
  const rel = path.relative(root, full);
  const text = fs.readFileSync(full, "utf8");
  if (/REPLACE_WITH|CHANGEME|TODO\b|FIXME\b/i.test(text))
    fail(`Release placeholder found in ${rel}.`);
  if (rel.startsWith("cloudflare") && /console\.log\(/.test(text))
    warn(`console.log remains in Worker source: ${rel}`);
}

for (const warning of warnings) console.warn("WARN:", warning);
if (failures.length) {
  console.error("\nBrandSparQ launch audit FAILED:");
  for (const failure of failures) console.error(" -", failure);
  process.exit(1);
}
console.log(
  `BrandSparQ launch audit passed: ${migrations.length} migrations, ${sourceFiles.length} source/config files checked.`,
);

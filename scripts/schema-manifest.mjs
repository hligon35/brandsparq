import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const db = new DatabaseSync(":memory:");
for (const file of readdirSync("cloudflare/migrations")
  .filter((n) => n.endsWith(".sql"))
  .sort())
  db.exec(readFileSync(`cloudflare/migrations/${file}`, "utf8"));
const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all();
const schema = Object.fromEntries(
  tables.map(({ name }) => [
    name,
    db
      .prepare(`PRAGMA table_info("${name}")`)
      .all()
      .map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk })),
  ]),
);
const indexes = db
  .prepare(
    "SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name",
  )
  .all();
const triggers = db
  .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name")
  .all();
const output =
  "// Generated from the ordered migrations by npm run schema:generate.\nexport const REQUIRED_SCHEMA = " +
  JSON.stringify(schema, null, 2) +
  " as const;\nexport const REQUIRED_INDEXES = " +
  JSON.stringify(indexes, null, 2) +
  " as const;\nexport const REQUIRED_TRIGGERS = " +
  JSON.stringify(triggers, null, 2) +
  " as const;\n";
const target = "cloudflare/src/schema.ts";
if (process.argv.includes("--check")) {
  // Compare exported data so formatter changes cannot invalidate the manifest.
  const js = ts.transpileModule(readFileSync(target, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText;
  const actual = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  if (
    JSON.stringify(actual.REQUIRED_SCHEMA) !== JSON.stringify(schema) ||
    JSON.stringify(actual.REQUIRED_INDEXES) !== JSON.stringify(indexes) ||
    JSON.stringify(actual.REQUIRED_TRIGGERS) !== JSON.stringify(triggers)
  )
    throw new Error("Schema manifest differs from migrations; run npm run schema:generate.");
} else writeFileSync(target, output);
db.close();

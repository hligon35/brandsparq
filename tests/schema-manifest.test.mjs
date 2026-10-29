import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSchemaSql } from "../cloudflare/src/schema-sql.ts";

function fixture(t, lineEnding) {
  const dir = mkdtempSync(join(tmpdir(), "brandsparq-schema-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "cloudflare/migrations"), { recursive: true });
  mkdirSync(join(dir, "cloudflare/src"), { recursive: true });
  const migrations = new URL("../cloudflare/migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((file) => file.endsWith(".sql"))) {
    const sql = readFileSync(new URL(file, migrations), "utf8");
    writeFileSync(
      join(dir, "cloudflare/migrations", file),
      sql.replace(/\r\n?/g, "\n").replace(/\n/g, lineEnding),
    );
  }
  writeFileSync(
    join(dir, "cloudflare/src/schema.ts"),
    readFileSync(new URL("../cloudflare/src/schema.ts", import.meta.url)),
  );
  const script = fileURLToPath(new URL("../scripts/schema-manifest.mjs", import.meta.url));
  return {
    dir,
    run: (...args) =>
      execFileSync(process.execPath, [script, ...args], { cwd: dir, stdio: "pipe" }),
  };
}

test("schema validation accepts Windows CRLF migrations and generates the same data", (t) => {
  const windows = fixture(t, "\r\n");
  const unix = fixture(t, "\n");
  windows.run("--check");
  windows.run();
  unix.run();
  assert.equal(
    readFileSync(join(windows.dir, "cloudflare/src/schema.ts"), "utf8"),
    readFileSync(join(unix.dir, "cloudflare/src/schema.ts"), "utf8"),
  );
  windows.run("--check");
});

test("schema validation still rejects an actual index or trigger definition change", (t) => {
  const f = fixture(t, "\r\n");
  writeFileSync(
    join(f.dir, "cloudflare/migrations/9999_changed.sql"),
    "CREATE INDEX unexpected_schema_index ON clients(name);",
  );
  assert.throws(() => f.run("--check"), /Schema manifest differs/);
});

test("runtime schema comparison changes only line endings and preserves missing definitions", () => {
  assert.equal(canonicalSchemaSql("CREATE INDEX x\r\nON t(a)"), "CREATE INDEX x\nON t(a)");
  assert.equal(canonicalSchemaSql(undefined), undefined);
  assert.notEqual(canonicalSchemaSql("ON t(a)"), canonicalSchemaSql("ON t(b)"));
});

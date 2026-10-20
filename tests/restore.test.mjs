import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyRestore } from "../scripts/lib/restore-verification.mjs";

test("disconnected restore checks row inventory, references and R2 bytes; damaged backup fails", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "brandsparq-restore-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sql = `CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE clients(id TEXT PRIMARY KEY); CREATE TABLE assets(id TEXT PRIMARY KEY,client_id TEXT REFERENCES clients(id),r2_key TEXT); CREATE TABLE posts(id TEXT PRIMARY KEY,graphic_key TEXT); INSERT INTO users VALUES('owner'); INSERT INTO clients VALUES('client'); INSERT INTO assets VALUES('asset','client','source/logo'); INSERT INTO posts VALUES('post',NULL);`;
  writeFileSync(join(dir, "logo"), "original");
  const manifest = {
    source: "fixture",
    capturedAt: new Date().toISOString(),
    counts: { users: 1, clients: 1, assets: 1, posts: 1 },
    media: [
      {
        key: "source/logo",
        file: "logo",
        sha256: createHash("sha256").update("original").digest("hex"),
      },
    ],
  };
  assert.equal(verifyRestore({ sql, manifest, mediaDirectory: dir }).mediaVerified, 1);
  assert.throws(
    () =>
      verifyRestore({
        sql,
        manifest: { ...manifest, counts: { ...manifest.counts, posts: 2 } },
        mediaDirectory: dir,
      }),
    /row count/,
  );
  assert.throws(
    () =>
      verifyRestore({
        sql: sql + "INSERT INTO assets VALUES('orphan','missing','lost');",
        manifest,
        mediaDirectory: dir,
      }),
    /orphan|FOREIGN KEY/,
  );
  assert.throws(
    () =>
      verifyRestore({
        sql: sql + "UPDATE posts SET graphic_key='missing-graphic';",
        manifest,
        mediaDirectory: dir,
      }),
    /R2 inventory is incomplete/,
  );
  writeFileSync(join(dir, "logo"), "damaged");
  assert.throws(() => verifyRestore({ sql, manifest, mediaDirectory: dir }), /checksum/);
});

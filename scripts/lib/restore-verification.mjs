import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";

// Restore into a new, disconnected database. Never run provider jobs or mutate
// the live database while inspecting a backup.
export function verifyRestore({ sql, manifest, mediaDirectory }) {
  if (
    !manifest.source ||
    !manifest.capturedAt ||
    !manifest.counts ||
    !Array.isArray(manifest.media)
  )
    throw new Error("Backup manifest requires source, capturedAt, counts and media.");
  for (const name of ["users", "clients", "assets", "posts"])
    if (!Number.isSafeInteger(manifest.counts[name]) || manifest.counts[name] < 0)
      throw new Error(`Missing row inventory: ${name}`);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(sql);
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok")
      throw new Error("Restored SQLite integrity check failed.");
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Restored snapshot contains orphan references.");
    for (const [table, count] of Object.entries(manifest.counts)) {
      if (!/^[a-z_]+$/.test(table) || !Number.isSafeInteger(count) || count < 0)
        throw new Error("Invalid table inventory.");
      if (db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count !== count)
        throw new Error(`Restored row count differs: ${table}`);
    }
    const assets = db.prepare("SELECT r2_key FROM assets").all();
    const keys = new Set(manifest.media.map((item) => item.key));
    if (keys.size !== manifest.media.length || assets.some((row) => !keys.has(row.r2_key)))
      throw new Error("R2 inventory is incomplete or duplicated.");
    for (const item of manifest.media) {
      if (!item.file || !/^[a-f0-9]{64}$/.test(item.sha256))
        throw new Error("Invalid media inventory.");
      const root = resolve(mediaDirectory);
      const file = resolve(root, item.file);
      const part = relative(root, file);
      if (part.startsWith("..") || isAbsolute(part))
        throw new Error("Media path leaves restore directory.");
      const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
      if (hash !== item.sha256) throw new Error(`Restored media checksum differs: ${item.key}`);
    }
    return {
      source: manifest.source,
      capturedAt: manifest.capturedAt,
      counts: manifest.counts,
      mediaVerified: manifest.media.length,
      integrity: "ok",
    };
  } finally {
    db.close();
  }
}

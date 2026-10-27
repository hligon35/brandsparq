import { DatabaseSync } from "node:sqlite";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash, createDecipheriv } from "node:crypto";

function validateRestoreSQL(sql) {
  if (typeof sql !== "string") throw new Error("Restore SQL must be text.");
  // A dump is data input, not permission to attach/write other databases or load extensions.
  const statements = sql.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,
    " ",
  );
  if (
    /\b(?:ATTACH|DETACH|VACUUM|load_extension)\b/i.test(statements) ||
    /\bPRAGMA\b(?!\s+(?:foreign_keys|defer_foreign_keys)\b)/i.test(statements)
  )
    throw new Error("Restore SQL contains a forbidden external database or PRAGMA operation.");
}

// Restore into a new, disconnected database. Never run provider jobs or mutate
// the live database while inspecting a backup.
export function verifyRestore({ sql, manifest, mediaDirectory }) {
  if (
    !manifest ||
    !manifest.source ||
    !manifest.capturedAt ||
    !manifest.counts ||
    !Array.isArray(manifest.media)
  )
    throw new Error("Backup manifest requires source, capturedAt, counts and media.");
  for (const name of ["users", "clients", "assets", "posts"])
    if (!Number.isSafeInteger(manifest.counts[name]) || manifest.counts[name] < 0)
      throw new Error(`Missing row inventory: ${name}`);
  validateRestoreSQL(sql);
  const db = new DatabaseSync(":memory:", { allowExtension: false });
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
    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.name);
    for (const table of tableNames) {
      if (table.startsWith("_cf") || table === "d1_migrations") continue;
      if (!(table in manifest.counts)) throw new Error(`Missing row inventory: ${table}`);
    }
    const keys = new Set(manifest.media.map((item) => item.key));
    if (keys.size !== manifest.media.length)
      throw new Error("R2 inventory contains duplicate keys.");
    // Graphics and derivatives are separate from source assets and must survive
    // restoration too. Expiring access-token tables are deliberately not sources.
    const references = {
      assets: "r2_key",
      posts: "graphic_key",
      asset_derivatives: "r2_key",
      creative_variants: "r2_key",
    };
    for (const [table, column] of Object.entries(references)) {
      if (!tableNames.includes(table)) continue;
      if (
        !db
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .some((row) => row.name === column)
      )
        continue;
      const rows = db
        .prepare(`SELECT "${column}" AS key FROM "${table}" WHERE "${column}" IS NOT NULL`)
        .all();
      if (rows.some((row) => !keys.has(row.key)))
        throw new Error(`R2 inventory is incomplete: ${table}.${column}`);
    }
    for (const item of manifest.media) {
      if (
        typeof item.key !== "string" ||
        !item.key ||
        typeof item.file !== "string" ||
        !item.file ||
        !/^[a-f0-9]{64}$/.test(item.sha256)
      )
        throw new Error("Invalid media inventory.");
      const root = resolve(mediaDirectory);
      const file = resolve(root, item.file);
      const part = relative(root, file);
      if (part.startsWith("..") || isAbsolute(part))
        throw new Error("Media path leaves restore directory.");
      const realRoot = realpathSync(root),
        realFile = realpathSync(file),
        realPart = relative(realRoot, realFile);
      if (realPart.startsWith("..") || isAbsolute(realPart))
        throw new Error("Media symlink leaves restore directory.");
      const hash = createHash("sha256").update(readFileSync(realFile)).digest("hex");
      if (hash !== item.sha256) throw new Error(`Restored media checksum differs: ${item.key}`);
    }
    return {
      source: manifest.source,
      capturedAt: manifest.capturedAt,
      counts: manifest.counts,
      mediaVerified: manifest.media.length,
      integrity: "ok",
      sqlSha256: createHash("sha256").update(sql).digest("hex"),
      remoteRestoreVerified: false,
    };
  } finally {
    db.close();
  }
}

// Decrypt only in memory. Neither ciphertext nor plaintext tokens are included in the receipt.
export function verifyRestoredTokens({ sql, key }) {
  if (typeof key !== "string" || !key)
    throw new Error("Provide the retained SOCIAL_TOKEN_KEY through BRANDSPARQ_RESTORE_TOKEN_KEY.");
  validateRestoreSQL(sql);
  const db = new DatabaseSync(":memory:", { allowExtension: false }),
    secret = createHash("sha256").update(key).digest();
  let verified = 0;
  try {
    db.exec(sql);
    const columns = db
      .prepare("PRAGMA table_info(social_accounts)")
      .all()
      .map((row) => row.name);
    for (const column of ["access_token_ciphertext", "refresh_token_ciphertext"].filter((name) =>
      columns.includes(name),
    )) {
      for (const row of db
        .prepare(`SELECT ${column} AS payload FROM social_accounts WHERE ${column} IS NOT NULL`)
        .all()) {
        try {
          const [version, iv, data, ...extra] = row.payload.split(".");
          if (version !== "v1" || !iv || !data || extra.length) throw new Error();
          const ciphertext = Buffer.from(data, "base64"),
            nonce = Buffer.from(iv, "base64");
          if (nonce.length !== 12 || ciphertext.length < 16) throw new Error();
          const decipher = createDecipheriv("aes-256-gcm", secret, nonce);
          decipher.setAuthTag(ciphertext.subarray(-16));
          const plain = Buffer.concat([
            decipher.update(ciphertext.subarray(0, -16)),
            decipher.final(),
          ]);
          plain.fill(0);
          verified++;
        } catch {
          throw new Error(
            "Restored provider token decryption failed. Check the retained key and backup integrity.",
          );
        }
      }
    }
    return {
      encryptedTokensVerified: verified,
      tokenDecryptionVerified: true,
      remoteRestoreVerified: false,
    };
  } finally {
    secret.fill(0);
    db.close();
  }
}

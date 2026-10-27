import { readFileSync } from "node:fs";
import { verifyRestore, verifyRestoredTokens } from "./lib/restore-verification.mjs";
const [sqlFile, manifestFile, mediaDirectory] = process.argv.slice(2);
if (!sqlFile || !manifestFile || !mediaDirectory)
  throw new Error(
    "Usage: npm run verify:restore -- backup.sql inventory.json restored-media-directory",
  );
const sql = readFileSync(sqlFile, "utf8");
const receipt = verifyRestore({
  sql,
  manifest: JSON.parse(readFileSync(manifestFile, "utf8")),
  mediaDirectory,
});
if (process.argv.includes("--verify-tokens"))
  Object.assign(
    receipt,
    verifyRestoredTokens({ sql, key: process.env.BRANDSPARQ_RESTORE_TOKEN_KEY }),
  );
console.log(JSON.stringify(receipt, null, 2));

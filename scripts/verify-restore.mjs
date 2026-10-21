import { readFileSync } from "node:fs";
import { verifyRestore } from "./lib/restore-verification.mjs";
const [sqlFile, manifestFile, mediaDirectory] = process.argv.slice(2);
if (!sqlFile || !manifestFile || !mediaDirectory)
  throw new Error(
    "Usage: npm run verify:restore -- backup.sql inventory.json restored-media-directory",
  );
console.log(
  JSON.stringify(
    verifyRestore({
      sql: readFileSync(sqlFile, "utf8"),
      manifest: JSON.parse(readFileSync(manifestFile, "utf8")),
      mediaDirectory,
    }),
    null,
    2,
  ),
);

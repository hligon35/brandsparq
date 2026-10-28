import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
const patchRoot = path.join(root, "patches/toolchain");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function verifyToolchainPatches({
  apply = false,
  installationRoot = path.join(root, "node_modules"),
} = {}) {
  const manifest = JSON.parse(readFileSync(path.join(patchRoot, "manifest.json"), "utf8"));
  if (manifest.formatVersion !== 1 || manifest.patches.length !== 7)
    throw new Error("Invalid toolchain patch manifest.");
  const required = [
    "deepmerge/index.js",
    "deepmerge/dist/cjs.js",
    "deepmerge/dist/umd.js",
    "zod/v3/types.js",
    "zod/v3/types.cjs",
    "zod/v4/core/schemas.js",
    "zod/v4/core/schemas.cjs",
  ];
  if (
    new Set(manifest.patches.map((item) => item.path)).size !== required.length ||
    required.some((name) => !manifest.patches.some((item) => item.path === name))
  )
    throw new Error("Incomplete toolchain patch coverage.");
  const remediated = new Set();
  for (const item of manifest.patches) {
    if (item.path.includes("..") || item.file.includes("/") || path.isAbsolute(item.path))
      throw new Error("Invalid patch path.");
    const version = JSON.parse(
      readFileSync(path.join(installationRoot, item.package, "package.json"), "utf8"),
    ).version;
    if (version !== item.version)
      throw new Error(
        `Review patches for updated ${item.package}; refusing an unverified version.`,
      );
    const target = path.join(installationRoot, item.path),
      payload = readFileSync(path.join(patchRoot, item.file));
    if (hash(payload) !== item.patchedSha256)
      throw new Error(`Patch artifact changed: ${item.path}`);
    const current = hash(readFileSync(target));
    if (current !== item.patchedSha256) {
      if (!apply || current !== item.originalSha256)
        throw new Error(`Toolchain patch missing or upstream content changed: ${item.path}`);
      writeFileSync(target, payload);
    }
    remediated.add(item.advisoryId);
  }
  return [...remediated];
}

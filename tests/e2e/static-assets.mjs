import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

// One immutable export per suite. Rebuilding/removing dist cannot invalidate
// the JavaScript or HTML of a browser session already using this fixture.
export function loadStaticAssets(root) {
  const files = new Map();
  const etags = new Map();
  function visit(directory, prefix = "") {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const name = `${prefix}/${item.name}`;
      if (item.isDirectory()) visit(path.join(directory, item.name), name);
      else if (item.isFile()) {
        const body = readFileSync(path.join(directory, item.name));
        files.set(name, body);
        etags.set(name, `"${createHash("sha256").update(body).digest("hex")}"`);
      }
    }
  }
  visit(root);
  if (!files.has("/index.html"))
    throw new Error("Export the web app before starting browser tests.");
  return (pathname, ifNoneMatch) => {
    let name;
    try {
      name = decodeURIComponent(pathname);
    } catch {
      return { status: 400, body: "Invalid path" };
    }
    if (name.split("/").some((part) => part === "..")) return { status: 404, body: "Not found" };
    if (!files.has(name)) {
      if (types[path.extname(name)] || name.startsWith("/_expo/"))
        return { status: 404, body: "Not found" };
      name = "/index.html";
    }
    const type = types[path.extname(name)] || "application/octet-stream";
    const headers = {
      "content-type": type,
      "cache-control": "public, max-age=0, must-revalidate",
      etag: etags.get(name),
    };
    if (
      ifNoneMatch
        ?.split(",")
        .some((item) => item.trim().replace(/^W\//, "") === headers.etag || item.trim() === "*")
    )
      return { status: 304, type, headers };
    return { status: 200, type, headers, body: files.get(name) };
  };
}

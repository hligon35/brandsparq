import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

test("test runtime has no inherited external provider transport", async () => {
  await assert.rejects(fetch("test://blocked"), /External network is disabled in the test runtime/);
});

test("Xcode project identifiers remain compatible with the patched UUID dependency", () => {
  const project = require("xcode").project("fixture.pbxproj");
  project.hash = { project: { objects: {} } };
  const ids = Array.from({ length: 100 }, () => project.generateUuid());
  assert.ok(ids.every((id) => /^[A-F0-9]{24}$/.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

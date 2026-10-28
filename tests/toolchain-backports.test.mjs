import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z as z3 } from "zod";
import { z as z4 } from "zod/v4";
import { verifyToolchainPatches } from "../scripts/lib/toolchain-patches.mjs";
import { assessAudit } from "../scripts/lib/dependency-disposition.mjs";
const require = createRequire(import.meta.url);
for (const [name, z] of [
  ["ESM v3", z3],
  ["CJS v3", require("zod")],
  ["ESM v4", z4],
  ["CJS v4", require("zod/v4")],
]) {
  test(`${name}: oversized arrays/sets/maps fail before element parsing, including async and unbounded schemas`, async () => {
    let calls = 0;
    const item = z.any().transform(() => {
      calls++;
      throw Error("Must not visit oversized input");
    });
    for (const [schema, input] of [
      [z.array(item).max(2), Array(3).fill(1)],
      [z.array(item).length(2), Array(3).fill(1)],
      [z.set(item).max(2), new Set([1, 2, 3])],
      [z.array(item), Array(10001).fill(1)],
      [z.set(item), new Set(Array.from({ length: 10001 }, (_, i) => i))],
      [z.map(item, item), new Map(Array.from({ length: 10001 }, (_, i) => [i, i]))],
    ]) {
      for (const async of [false, true]) {
        const result = await (async ? schema.safeParseAsync(input) : schema.safeParse(input));
        assert.equal(result.success, false);
        assert.ok(result.error.issues.length <= 2);
        assert.equal(result.error.issues[0].code, "too_big");
        assert.equal(calls, 0);
      }
    }
    const valid = z.object({
      items: z.array(z.string()).max(3),
      map: z.map(z.string(), z.number()),
      set: z.set(z.string()),
    });
    assert.equal(
      valid.safeParse({ items: ["valid"], map: new Map([["a", 1]]), set: new Set(["a"]) }).success,
      true,
    );
  });
}
for (const entry of ["deepmerge", "deepmerge/dist/umd.js"]) {
  test(`${entry}: hostile source and target keys cannot poison returned prototypes`, () => {
    const merge = require(entry),
      target = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
    const outputs = [
      merge(target, {}),
      merge(Object.create(null), target),
      merge({ nested: target }, { nested: {} }),
    ];
    for (const output of outputs) {
      const object = output.nested || output;
      assert.equal(Object.getPrototypeOf(object), Object.prototype);
      assert.equal(object.polluted, undefined);
      assert.equal({}.polluted, undefined);
    }
    const symbol = Symbol("key"),
      input = { [symbol]: { value: 1 }, items: [1] },
      merged = merge(input, { items: [2] });
    assert.deepEqual(merged.items, [1, 2]);
    assert.deepEqual(merged[symbol], { value: 1 });
    assert.notEqual(merged[symbol], input[symbol]);
    assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
    assert.deepEqual(merge({ list: [1] }, { list: [2] }, { arrayMerge: (_a, b) => b }), {
      list: [2],
    });
  });
}
test("toolchain verification rejects missing, modified and wrong-version installed sources", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "brandsparq-patches-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manifest = JSON.parse(
    readFileSync(new URL("../patches/toolchain/manifest.json", import.meta.url)),
  );
  for (const item of manifest.patches) {
    const dest = path.join(dir, item.path);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(
      dest,
      readFileSync(new URL("../patches/toolchain/" + item.file, import.meta.url)),
    );
    writeFileSync(
      path.join(dir, item.package, "package.json"),
      JSON.stringify({ version: item.version }),
    );
  }
  assert.equal(verifyToolchainPatches({ installationRoot: dir }).length, 2);
  const leaf = path.join(dir, manifest.patches[0].path);
  writeFileSync(leaf, "tampered");
  assert.throws(
    () => verifyToolchainPatches({ installationRoot: dir, apply: true }),
    /upstream content changed/,
  );
  writeFileSync(
    leaf,
    readFileSync(new URL("../patches/toolchain/" + manifest.patches[0].file, import.meta.url)),
  );
  writeFileSync(path.join(dir, "deepmerge/package.json"), '{"version":"4.3.2"}');
  assert.throws(() => verifyToolchainPatches({ installationRoot: dir }), /unverified version/);
});
test("local backports do not exempt unknown advisories or unpatched nested package copies", () => {
  const make = (url, nodes = ["node_modules/deepmerge"]) => ({
    metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 0, total: 1 } },
    vulnerabilities: { deepmerge: { name: "deepmerge", nodes, via: [{ url }] } },
  });
  const lock = {
    packages: {
      "node_modules/deepmerge": { version: "4.3.1" },
      "node_modules/example/node_modules/deepmerge": { version: "4.3.1" },
    },
  };
  const id = "GHSA-gcqx-w48m-w2h4",
    options = { remediated: verifyToolchainPatches() };
  assert.equal(
    assessAudit(make(`https://github.com/advisories/${id}`), lock, options).securityClear,
    true,
  );
  assert.equal(
    assessAudit(
      make(`https://github.com/advisories/${id}`, ["node_modules/example/node_modules/deepmerge"]),
      lock,
      options,
    ).securityClear,
    false,
  );
  assert.throws(
    () => assessAudit(make("https://github.com/advisories/GHSA-unknown"), lock, options),
    /Unreviewed/,
  );
});
test("remediated runtime paths cannot hide an unpatched nested package from release dispositions", async () => {
  const { requiredDispositions } = await import("../scripts/lib/dependency-disposition.mjs");
  const lock = {
    packages: {
      "node_modules/zod": { version: "3.25.76" },
      "node_modules/example/node_modules/zod": { version: "3.25.76" },
    },
  };
  assert.deepEqual(requiredDispositions(lock, { remediated: verifyToolchainPatches() }), [
    "GHSA-mrhx-c7xc-m3w5",
  ]);
});
test("verified patches cannot make an incomplete nonzero audit report pass", () => {
  const report = {
    metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 0, total: 1 } },
    vulnerabilities: {},
  };
  assert.throws(
    () => assessAudit(report, { packages: {} }, { remediated: verifyToolchainPatches() }),
    /do not match/,
  );
});

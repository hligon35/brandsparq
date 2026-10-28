import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createApiTransport, readResponse } from "../src/api/transport.ts";
import { createSerialQueue } from "../src/shared/serial-queue.ts";
import { createDeviceRegistrationStore } from "../src/notifications/device-store.ts";
import { loadStaticAssets } from "./e2e/static-assets.mjs";
import { assessAudit, verifyAdvisoryDispositions } from "../scripts/lib/dependency-disposition.mjs";
import { verifyCheckout } from "../scripts/lib/checkout.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const zero = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };

test("device registration waits for departing-account cleanup before writing the new registration", async () => {
  let stored = "old",
    backend = "old";
  const gate = deferred(),
    began = deferred();
  const device = createDeviceRegistrationStore({
    read: async () => stored,
    write: async (value) => {
      stored = value;
    },
    remove: async () => {
      stored = null;
    },
  });
  const clearing = device.unregister(async (value) => {
    assert.equal(value, "old");
    began.resolve();
    await gate.promise;
    backend = null;
  });
  await began.promise;
  const saving = device.register(
    "new",
    async () => {
      backend = "new";
    },
    () => true,
  );
  assert.equal(stored, "old");
  gate.resolve();
  await Promise.all([clearing, saving]);
  assert.equal(stored, "new");
  assert.equal(backend, "new");
});

test("a sign-out during native storage writes prevents registration under a changed session", async () => {
  const api = createApiTransport("https://fixture.test");
  api.setToken("old");
  const session = api.captureSession(),
    gate = deferred(),
    began = deferred();
  let stored = null,
    sent = false;
  const device = createDeviceRegistrationStore({
    read: async () => stored,
    write: async (value) => {
      began.resolve();
      await gate.promise;
      stored = value;
    },
    remove: async () => {
      stored = null;
    },
  });
  const saving = device.register(
    "device",
    async () => {
      sent = true;
    },
    session.isCurrent,
  );
  const rejected = assert.rejects(saving, /sign-in changed/);
  await began.promise;
  api.setToken(null);
  const clearing = device.unregister(async (token) => {
    assert.equal(token, "device");
  });
  gate.resolve();
  await rejected;
  await clearing;
  assert.equal(sent, false);
  assert.equal(stored, null);
  api.setToken("new");
  await assert.rejects(
    device.register(
      "stale",
      async () => {
        sent = true;
      },
      session.isCurrent,
    ),
    /sign-in changed/,
  );
  assert.equal(stored, null);
  assert.equal(sent, false);
});

test("dependency acceptance requires the exact owner decision, mitigations and an unexpired review", () => {
  const ids = ["GHSA-mrhx-c7xc-m3w5"];
  const gate = () => ({
    ownerAccepted: true,
    dispositions: [
      {
        advisoryId: ids[0],
        package: "zod",
        version: "3.25.76",
        decision: "accepted",
        approvedBy: "Fixture owner",
        recordedAt: new Date().toISOString(),
        nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
        mitigations: ["Fixture-only owner decision; no release authorization."],
      },
    ],
  });
  verifyAdvisoryDispositions(gate(), ids);
  assert.throws(() => verifyAdvisoryDispositions({ ownerAccepted: true }, ids), /owner/);
  for (const patch of [
    { decision: "pending" },
    { approvedBy: "" },
    { mitigations: [] },
    { nextReviewAt: "2000-01-01" },
    { nextReviewAt: "2099-01-01" },
    { version: "4.6.6" },
    { recordedAt: "2000-01-01" },
  ]) {
    const value = gate();
    Object.assign(value.dispositions[0], patch);
    assert.throws(() => verifyAdvisoryDispositions(value, ids), /current owner decision/);
  }
});

test("request deadline covers a body that never finishes and a fetch that ignores abort", async () => {
  let signal;
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"pending":'));
      },
    }),
  );
  const api = createApiTransport("https://fixture.test", async (_, init) => {
    signal = init.signal;
    return response;
  });
  await assert.rejects(
    api.json("/read", undefined, { timeoutMs: 20, retries: 0 }),
    (e) => e.code === "TIMEOUT",
  );
  assert.equal(signal.aborted, true);
  const gate = deferred();
  let consumed = false;
  await assert.rejects(
    readResponse(
      "https://fixture.test",
      undefined,
      async () => {
        consumed = true;
      },
      { timeoutMs: 20, fetcher: () => gate.promise },
    ),
    (e) => e.code === "TIMEOUT",
  );
  gate.resolve(Response.json({}));
  await new Promise((r) => setImmediate(r));
  assert.equal(consumed, false);
});

test("read retries are bounded; mutations, HTTP failures and explicit cancellations are not replayed", async () => {
  let count = 0;
  const api = createApiTransport("https://fixture.test", async () => {
    if (++count === 1) throw new TypeError("offline");
    return Response.json({ ok: true });
  });
  assert.equal((await api.json("/read")).ok, true);
  assert.equal(count, 2);
  count = 0;
  await assert.rejects(
    api.json("/create", { method: "POST", body: "{}" }),
    (e) => e.code === "NETWORK",
  );
  assert.equal(count, 1);
  count = 0;
  const failed = createApiTransport("https://fixture.test", async () => {
    count++;
    return Response.json({ error: "Unavailable" }, { status: 503 });
  });
  await assert.rejects(failed.json("/read"), (e) => e.status === 503);
  assert.equal(count, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    failed.json("/read", { signal: controller.signal }),
    (e) => e.code === "ABORTED",
  );
  assert.equal(count, 1);
});

test("a stale 401 and departing-account cleanup cannot sign out the newer session", async () => {
  const gate = deferred();
  let sent,
    cleared = 0;
  const api = createApiTransport("https://fixture.test", async (_, init) => {
    sent = init.headers.get("authorization");
    return gate.promise;
  });
  api.setUnauthorizedHandler(() => {
    cleared++;
    api.setToken(null);
  });
  api.setToken("old");
  const cleanupHeaders = api.headers();
  const request = api.json("/v1/profile");
  api.setToken("new");
  gate.resolve(Response.json({ error: "Expired" }, { status: 401 }));
  await assert.rejects(request, (e) => e.status === 401);
  assert.equal(sent, "Bearer old");
  assert.equal(cleared, 0);
  await assert.rejects(
    api.json("/v1/auth/logout", { method: "POST", headers: cleanupHeaders }),
    (e) => e.status === 401,
  );
  assert.equal(sent, "Bearer old");
  assert.equal(cleared, 0);
  assert.equal(api.headers().get("authorization"), "Bearer new");
  await assert.rejects(api.json("/v1/profile"), (e) => e.status === 401);
  assert.equal(cleared, 1);
});

test("invalid public links and failed OAuth handoffs do not clear an existing login", async () => {
  const api = createApiTransport("https://fixture.test", async () =>
    Response.json({ error: "Invalid link" }, { status: 401 }),
  );
  let cleared = false;
  api.setToken("active");
  api.setUnauthorizedHandler(() => {
    cleared = true;
  });
  for (const path of ["/v1/public/review/expired", "/v1/auth/google/complete"])
    await assert.rejects(api.json(path), (e) => e.status === 401);
  assert.equal(cleared, false);
  api.setToken(null);
  await assert.rejects(api.json("/v1/profile"), (e) => e.status === 401);
  assert.equal(cleared, false);
});

test("credential deletion finishes before a subsequent write and storage failures do not poison the queue", async () => {
  const serialize = createSerialQueue(),
    gate = deferred();
  let stored = "old";
  const clearing = serialize(async () => {
    await gate.promise;
    stored = null;
  });
  const saving = serialize(() => {
    stored = "new";
  });
  assert.equal(stored, "old");
  gate.resolve();
  await Promise.all([clearing, saving]);
  assert.equal(stored, "new");
  await assert.rejects(
    serialize(() => {
      throw new Error("locked");
    }),
    /locked/,
  );
  await serialize(() => {
    stored = "recovered";
  });
  assert.equal(stored, "recovered");
});

test("browser fixture serves one immutable export and missing assets never become HTML", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "brandsparq-static-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "index.html"), "original app");
  writeFileSync(join(dir, "app.js"), "original JS");
  const asset = loadStaticAssets(dir);
  rmSync(join(dir, "index.html"));
  rmSync(join(dir, "app.js"));
  assert.equal(asset("/calendar").body.toString(), "original app");
  assert.equal(asset("/app.js").body.toString(), "original JS");
  const cached = asset("/app.js", asset("/app.js").headers.etag);
  assert.equal(cached.status, 304);
  assert.equal(cached.body, undefined);
  assert.equal(cached.headers["cache-control"], "public, max-age=0, must-revalidate");
  assert.equal(asset("/app.js", '\"different\"').status, 200);
  assert.equal(asset("/missing.js").status, 404);
  assert.equal(asset("/%invalid").status, 400);
  assert.equal(asset("/../private").status, 404);
});

test("audit cannot declare security clearance for missing advisory leaves or inconsistent totals", () => {
  assert.equal(
    assessAudit({ metadata: { vulnerabilities: zero }, vulnerabilities: {} }, {}).securityClear,
    true,
  );
  const report = {
    metadata: { vulnerabilities: { ...zero, high: 1, total: 1 } },
    vulnerabilities: { expo: { name: "expo", via: ["missing"] } },
  };
  assert.throws(() => assessAudit(report, {}), /incomplete advisory chain/);
  assert.throws(
    () =>
      assessAudit({ metadata: { vulnerabilities: { ...zero, high: 1 } }, vulnerabilities: {} }, {}),
    /consistent/,
  );
  assert.throws(
    () =>
      assessAudit(
        { metadata: { vulnerabilities: { ...zero, high: 1, total: 1 } }, vulnerabilities: {} },
        {},
      ),
    /advisory graph/,
  );
});

test("deployment rejects source edits and a moved HEAD after validation", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "brandsparq-checkout-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  writeFileSync(join(dir, "source"), "first");
  git("add", ".");
  const commit = () =>
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-qm",
      "fixture",
    );
  commit();
  const accepted = git("rev-parse", "HEAD");
  verifyCheckout(accepted, dir);
  writeFileSync(join(dir, "source"), "changed");
  assert.throws(() => verifyCheckout(accepted, dir), /source changed/);
  git("add", ".");
  commit();
  assert.throws(() => verifyCheckout(accepted, dir), /source changed/);
});

test("Cloudflare compilation fixes the origin, clears fixture flags and checks source metadata", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "brandsparq-build-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "commands.jsonl"),
    cli = join(dir, "npm.cjs");
  writeFileSync(
    cli,
    `require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),api:process.env.EXPO_PUBLIC_API_URL,fixture:process.env.BRANDSPARQ_E2E_BUILD})+'\\n');`,
  );
  const script = fileURLToPath(new URL("../scripts/build-cloudflare.mjs", import.meta.url));
  const env = {
    ...process.env,
    npm_execpath: cli,
    EXPO_PUBLIC_API_URL: "http://localhost:8788",
    BRANDSPARQ_E2E_BUILD: "1",
    BRANDSPARQ_APP_ENV: "production",
  };
  delete env.WORKERS_CI_COMMIT_SHA;
  execFileSync(process.execPath, [script], { env, stdio: "pipe" });
  const commands = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(
    commands.map((c) => c.args),
    [
      ["ci", "--prefix", "cloudflare"],
      ["run", "build:web"],
    ],
  );
  assert.ok(
    commands.every((c) => c.api === "https://brandsparq.getsparqd.com" && c.fixture === "0"),
  );
  for (const patch of [
    { WORKERS_CI_COMMIT_SHA: "wrong" },
    {
      BRANDSPARQ_APP_ENV: "staging",
      BRANDSPARQ_STAGING_ORIGIN: "https://brandsparq.getsparqd.com",
    },
    { BRANDSPARQ_APP_ENV: "typo" },
  ])
    assert.throws(() =>
      execFileSync(process.execPath, [script], { env: { ...env, ...patch }, stdio: "pipe" }),
    );
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2);
});

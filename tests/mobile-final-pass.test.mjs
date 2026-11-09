import test from "node:test";
import assert from "node:assert/strict";
import { createActiveRefresh } from "../src/shared/active-refresh.ts";
import { colorChannelAt } from "../src/shared/color-control.ts";
import {
  clientDiagnostic,
  sanitizeClientDiagnostic,
  installRuntimeHandler,
} from "../src/shared/client-diagnostic.ts";
import { createDiagnosticQueue } from "../src/shared/diagnostic-queue.ts";
import { workspace } from "./workspace.mjs";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function clock() {
  const timers = new Map();
  let id = 0;
  return {
    timers,
    set(fn) {
      timers.set(++id, fn);
      return id;
    },
    clear(id) {
      timers.delete(id);
    },
    fire() {
      const [id, fn] = timers.entries().next().value;
      timers.delete(id);
      fn();
    },
  };
}
test("active refresh pauses polling and invalidates a late background response", async () => {
  const timers = clock(),
    requests = [],
    done = [];
  const refresh = createActiveRefresh(
    (context) => new Promise((resolve) => requests.push({ context, resolve })),
    5000,
    timers,
  );
  refresh.setActive(true);
  assert.equal(requests.length, 1);
  assert.equal(timers.timers.size, 0);
  refresh.setActive(false);
  assert.equal(requests[0].context.current(), false);
  refresh.setActive(true);
  assert.equal(requests.length, 1);
  requests[0].resolve();
  await tick();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].context.reason, "foreground");
  requests[1].resolve();
  await tick();
  assert.equal(timers.timers.size, 1);
  timers.fire();
  assert.equal(requests[2].context.reason, "poll");
  refresh.dispose();
  requests[2].resolve();
  await tick();
  assert.equal(requests[2].context.current(), false);
  assert.equal(timers.timers.size, 0);
});
test("refresh coalesces repeated taps into one followup and drains before resolving", async () => {
  const requests = [];
  const refresh = createActiveRefresh(
    (context) => new Promise((resolve) => requests.push({ context, resolve })),
  );
  refresh.setActive(true);
  const first = refresh.request(),
    second = refresh.request(),
    third = refresh.request();
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(requests.length, 1);
  requests[0].resolve();
  await tick();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].context.reason, "manual");
  requests[1].resolve();
  await first;
  assert.equal(requests.length, 2);
  refresh.dispose();
});
test("a rejected foreground request can recover on the next poll", async () => {
  const timers = clock();
  let calls = 0;
  const refresh = createActiveRefresh(
    async () => {
      calls++;
      throw Error("offline");
    },
    5,
    timers,
  );
  refresh.setActive(true);
  await tick();
  assert.equal(timers.timers.size, 1);
  timers.fire();
  await tick();
  assert.equal(calls, 2);
  refresh.setActive(false);
  assert.equal(timers.timers.size, 0);
  await refresh.request();
  assert.equal(calls, 2);
  refresh.dispose();
});
test("a manual refresh queued before backgrounding is not replayed while hidden", async () => {
  let finish;
  let count = 0;
  const refresh = createActiveRefresh(async () => {
    count++;
    await new Promise((resolve) => (finish = resolve));
  });
  refresh.setActive(true);
  const pending = refresh.request();
  refresh.setActive(false);
  finish();
  await pending;
  assert.equal(count, 1);
  refresh.dispose();
  refresh.setActive(true);
  assert.equal(count, 1);
});
test("RGB channels scale to measured widths and clamp drags outside the track", () => {
  for (const width of [160, 240, 350, 680]) {
    assert.equal(colorChannelAt(0, width), 0);
    assert.equal(colorChannelAt(width, width), 255);
    assert.equal(colorChannelAt(width / 2, width), 128);
    assert.equal(colorChannelAt(-5, width), 0);
    assert.equal(colorChannelAt(width + 100, width), 255);
  }
  for (const width of [0, -1, NaN, Infinity]) assert.equal(colorChannelAt(40, width), 0);
  assert.equal(colorChannelAt(NaN, 240), 0);
});
test("runtime diagnostics remove messages, URLs, paths and unknown fields", () => {
  const error = {
    name: "TypeError",
    message: "secret-caption email@example.com",
    stack:
      "TypeError: secret-token\n at callback (https://host/index.bundle?token=private:123:45)\n at private (/Users/harold/secret.ts:1:2)\n at render (https://host/_expo/static/js/web/entry-aabbcc.js:80:90)",
  };
  const result = clientDiagnostic(
    error,
    "runtime",
    true,
    "ios",
    "0.1.1",
    "12345678-1234-1234-1234-123456789abc",
  );
  assert.deepEqual(result.frames, [
    { line: 123, column: 45 },
    { line: 80, column: 90 },
  ]);
  assert.equal(result.code, "TYPE_ERROR");
  assert.equal(result.updateId, "12345678-1234-1234-1234-123456789abc");
  assert.doesNotMatch(JSON.stringify(result), /private|secret|harold|host|email|callback/);
  const safe = sanitizeClientDiagnostic({
    ...result,
    message: "token",
    url: "https://private",
    version: "0.1.1-private",
    updateId: "secret",
    platform: "account",
    frames: [{ line: 2, column: 3, filename: "private" }, { line: -1, column: 3 }, null],
  });
  assert.equal(safe.version, "unknown");
  assert.equal(safe.updateId, "embedded");
  assert.equal(safe.platform, "unknown");
  assert.deepEqual(safe.frames, [{ line: 2, column: 3 }]);
  assert.ok(!("message" in safe));
  assert.equal(sanitizeClientDiagnostic({ code: "arbitrary-secret", source: "runtime" }), null);
  assert.equal(
    clientDiagnostic({ name: "toString" }, "runtime", false, "android").code,
    "UNKNOWN_ERROR",
  );
  assert.equal(clientDiagnostic(null, "render", true, "web").code, "RENDER_ERROR");
});
test("runtime handler preserves the framework handler even if reporting fails", () => {
  const calls = [];
  const original = (...args) => calls.push(args);
  let handler = original;
  const target = { getGlobalHandler: () => handler, setGlobalHandler: (next) => (handler = next) };
  const uninstall = installRuntimeHandler(target, () => {
    throw Error("storage failed");
  });
  const error = Error("failure");
  handler(error, true);
  assert.deepEqual(calls, [[error, true]]);
  uninstall();
  assert.equal(handler, original);
  const release = installRuntimeHandler(target, () => {});
  const newer = () => {};
  handler = newer;
  release();
  assert.equal(handler, newer);
  assert.doesNotThrow(() => installRuntimeHandler(undefined, () => {})());
});
function diagnosticStore() {
  let saved = null,
    time = 10000;
  const storage = {
    read: async () => structuredClone(saved),
    write: async (rows) => (saved = structuredClone(rows)),
  };
  return {
    queue: createDiagnosticQueue(storage, () => time),
    storage,
    state: () => saved,
    setTime: (value) => (time = value),
  };
}
const diagnostic = clientDiagnostic(Error("private"), "render", true, "ios", "0.1.1");
test("offline diagnostics survive restart and only upload for their original account", async () => {
  const s = diagnosticStore();
  await s.queue.add("owner-a", diagnostic);
  await s.queue.flush(
    "owner-a",
    () => true,
    async () => {
      throw Error("offline");
    },
  );
  assert.equal(s.state().length, 1);
  const restarted = createDiagnosticQueue(s.storage, () => 10000);
  let sent = 0;
  await restarted.flush(
    "owner-b",
    () => true,
    async () => sent++,
  );
  assert.equal(sent, 0);
  assert.equal(s.state().length, 1);
  await restarted.flush(
    "owner-a",
    () => true,
    async (value) => {
      sent++;
      assert.deepEqual(value, diagnostic);
    },
  );
  assert.equal(sent, 1);
  assert.equal(s.state().length, 0);
});
test("diagnostics queue is bounded, expires old entries and stops on session change", async () => {
  const s = diagnosticStore();
  for (let i = 0; i < 15; i++) await s.queue.add("owner", diagnostic);
  assert.equal(s.state().length, 10);
  let current = true,
    sent = 0;
  await s.queue.flush(
    "owner",
    () => current,
    async () => {
      sent++;
      current = false;
    },
  );
  assert.equal(sent, 1);
  assert.equal(s.state().length, 9);
  s.setTime(10000 + 8 * 86400000);
  await s.queue.flush(
    "owner",
    () => true,
    async () => sent++,
  );
  assert.equal(sent, 1);
  assert.equal(s.state().length, 0);
});
test("diagnostic endpoint requires auth and rejects unknown error codes", async (t) => {
  const w = workspace(t);
  assert.equal(
    (await w.request("/v1/client-diagnostics", { method: "POST", body: diagnostic })).status,
    401,
  );
  assert.equal(
    (
      await w.request("/v1/client-diagnostics", {
        user: "owner",
        method: "POST",
        body: { ...diagnostic, code: "private-caption" },
      })
    ).status,
    400,
  );
  assert.equal(w.row("SELECT COUNT(*) AS n FROM system_events").n, 0);
});
test("authenticated diagnostics are sanitized, deduplicated and rate limited", async (t) => {
  const w = workspace(t);
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await w.request("/v1/client-diagnostics", {
          user: "owner",
          method: "POST",
          body: {
            ...diagnostic,
            message: "private-caption",
            stack: "private-token",
            frames: [{ line: 50, column: 20, url: "private-url" }],
          },
        })
      ).status,
      200,
    );
  assert.equal(
    (await w.request("/v1/client-diagnostics", { user: "owner", method: "POST", body: diagnostic }))
      .status,
    429,
  );
  const events = w.sqlite.prepare("SELECT * FROM system_events").all();
  assert.equal(events.length, 1);
  assert.equal(events[0].entity_id, "owner");
  assert.equal(events[0].category, "mobile");
  assert.doesNotMatch(JSON.stringify(events), /private-caption|private-token|private-url|stack/);
  assert.deepEqual(JSON.parse(events[0].metadata_json).frames, [{ line: 50, column: 20 }]);
});

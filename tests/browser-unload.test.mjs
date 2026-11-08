import test from "node:test";
import assert from "node:assert/strict";
import { protectBrowserUnload } from "../src/shared/browser-unload.ts";

test("a dirty Social Post draft does not attach browser events on iOS or Android", () => {
  for (const platform of ["ios", "android"]) {
    // React Native's window aliases globalThis; existence does not imply DOM APIs.
    const nativeWindow = {};
    nativeWindow.window = nativeWindow;
    assert.equal(
      protectBrowserUnload(platform, nativeWindow, () => true),
      undefined,
    );
    const unsupported = () => {
      throw new Error("Browser API called on native");
    };
    assert.equal(
      protectBrowserUnload(
        platform,
        {
          addEventListener: unsupported,
          removeEventListener: unsupported,
        },
        () => true,
      ),
      undefined,
    );
  }
});

test("missing browser event APIs are safe, including server rendering", () => {
  for (const target of [undefined, {}, { addEventListener() {} }])
    assert.equal(
      protectBrowserUnload("web", target, () => true),
      undefined,
    );
});

test("web reload protection tracks the current draft and removes its exact listener", () => {
  let dirty = true;
  const listeners = new Map();
  const target = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      assert.equal(listeners.get(type), listener);
      listeners.delete(type);
    },
  };
  const cleanup = protectBrowserUnload("web", target, () => dirty);
  let prevented = 0;
  const event = {
    preventDefault() {
      prevented++;
    },
    returnValue: undefined,
  };
  listeners.get("beforeunload")(event);
  assert.equal(prevented, 1);
  assert.equal(event.returnValue, "");
  dirty = false;
  listeners.get("beforeunload")(event);
  assert.equal(prevented, 1);
  cleanup();
  assert.equal(listeners.size, 0);
});

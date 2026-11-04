import test from "node:test";
import assert from "node:assert/strict";
import { createUpdateController } from "../src/updates/controller.ts";

function setup(overrides = {}) {
  const states = [],
    calls = [];
  const controller = createUpdateController({
    enabled: () => true,
    pending: () => false,
    check: async () => {
      calls.push("check");
      return { isAvailable: true };
    },
    download: async () => {
      calls.push("download");
      return { isNew: true };
    },
    confirmRestart: async () => {
      calls.push("confirm");
      return true;
    },
    beforeRestart: async () => {
      calls.push("draft-guard");
      return true;
    },
    reload: async () => {
      calls.push("reload");
    },
    changed: (state) => states.push(state),
    ...overrides,
  });
  return { controller, calls, states };
}

test("checking and downloading an update never restarts without a separate confirmed apply", async () => {
  const { controller, calls, states } = setup();
  await controller.check();
  assert.deepEqual(calls, ["check", "download"]);
  assert.equal(states.at(-1).ready, true);
  await controller.apply();
  assert.deepEqual(calls, ["check", "download", "confirm", "draft-guard", "reload"]);
});
test("a canceled unsaved-changes guard preserves the downloaded update for a later restart", async () => {
  let canLeave = false;
  const { controller, calls, states } = setup({ beforeRestart: async () => canLeave });
  await controller.check();
  await controller.apply();
  assert.ok(!calls.includes("reload"));
  assert.equal(states.at(-1).phase, "ready");
  canLeave = true;
  await controller.apply();
  assert.equal(calls.filter((c) => c === "download").length, 1);
  assert.equal(calls.filter((c) => c === "reload").length, 1);
});
test("repeated taps share one native check and download", async () => {
  let release;
  const waiting = new Promise((r) => {
    release = r;
  });
  let checks = 0;
  const { controller, calls } = setup({
    check: async () => {
      checks++;
      await waiting;
      return { isAvailable: true };
    },
  });
  const first = controller.check();
  await controller.check();
  release();
  await first;
  assert.equal(checks, 1);
  assert.equal(calls.filter((c) => c === "download").length, 1);
});
test("no compatible update is reported honestly without downloading or restarting", async () => {
  const { controller, calls, states } = setup({ check: async () => ({ isAvailable: false }) });
  await controller.check();
  await controller.apply();
  assert.deepEqual(calls, []);
  assert.equal(states.at(-1).phase, "current");
});
test("a downloaded pending update can be applied without another network request", async () => {
  const { controller, calls } = setup({ pending: () => true });
  await controller.check();
  await controller.apply();
  assert.deepEqual(calls, ["confirm", "draft-guard", "reload"]);
});
test("recovery rollback directives are downloaded and require explicit restart confirmation", async () => {
  const { controller, calls, states } = setup({
    check: async () => ({ isAvailable: false, isRollBackToEmbedded: true }),
    download: async () => ({ isNew: false, isRollBackToEmbedded: true }),
  });
  await controller.check();
  assert.equal(states.at(-1).ready, true);
  assert.match(states.at(-1).message, /recovery/);
  assert.deepEqual(calls, []);
  await controller.apply();
  assert.deepEqual(calls, ["confirm", "draft-guard", "reload"]);
});
test("disabled update builds never invoke native update operations", async () => {
  const { controller, calls, states } = setup({ enabled: () => false });
  await controller.check();
  await controller.apply();
  assert.deepEqual(calls, []);
  assert.equal(states.at(-1).phase, "unavailable");
});
test("network failures can be retried and reload failures retain a downloaded update", async () => {
  let downloads = 0,
    reloads = 0;
  const { controller, states } = setup({
    download: async () => {
      if (++downloads === 1) throw Error("offline");
      return { isNew: true };
    },
    reload: async () => {
      if (++reloads === 1) throw Error("restart failed");
    },
  });
  await controller.check();
  assert.equal(states.at(-1).phase, "error");
  await controller.check();
  assert.equal(states.at(-1).ready, true);
  await controller.apply();
  assert.equal(states.at(-1).phase, "error");
  assert.equal(states.at(-1).ready, true);
  await controller.apply();
  assert.equal(reloads, 2);
  assert.equal(downloads, 2);
});
test("leaving the screen during a check does not download, reload or update an unmounted view", async () => {
  let release;
  const waiting = new Promise((r) => {
    release = r;
  });
  const { controller, calls, states } = setup({
    check: async () => {
      await waiting;
      return { isAvailable: true };
    },
  });
  const checking = controller.check();
  const length = states.length;
  controller.dispose();
  release();
  await checking;
  await controller.apply();
  assert.equal(states.length, length);
  assert.deepEqual(calls, []);
});

test("leaving during restart confirmation cannot prompt for drafts or restart another screen", async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const { controller, calls } = setup({
    pending: () => true,
    confirmRestart: async () => {
      await waiting;
      return true;
    },
  });
  const applying = controller.apply();
  controller.dispose();
  release();
  await applying;
  assert.deepEqual(calls, []);
});

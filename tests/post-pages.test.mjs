import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import { collectPostPages } from "../src/shared/post-pages.ts";

test("review pages reach all actionable posts and filter access before applying limit", async (t) => {
  const w = workspace(t);
  for (let i = 0; i < 105; i++) w.post(`a-${String(i).padStart(3, "0")}`, "client-b");
  for (let i = 0; i < 103; i++)
    w.post(
      `b-${String(i).padStart(3, "0")}`,
      "client-a",
      i % 2 ? "edit_requested" : "awaiting_approval",
    );
  assert.equal((await w.request("/v1/posts/review", { user: "viewer" })).status, 426);
  let requests = 0;
  const rows = await collectPostPages(async (cursor) => {
    requests++;
    const res = await w.request(
      "/v1/posts/review?limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      { user: "viewer" },
    );
    assert.equal(res.status, 200);
    return res.json();
  });
  assert.equal(rows.length, 103);
  assert.equal(requests, 2);
  assert.ok(rows.every((row) => row.client_id === "client-a"));
});
test("calendar pages validate dates and retain stable boundaries", async (t) => {
  const w = workspace(t);
  w.post("start", "client-a", "calendar_scheduled");
  w.post("end", "client-a", "calendar_scheduled");
  w.exec("UPDATE posts SET scheduled_publish_at='2026-11-01T00:00:00.000Z' WHERE id='start'");
  w.exec("UPDATE posts SET scheduled_publish_at='2026-11-02T00:00:00.000Z' WHERE id='end'");
  const path = "/v1/posts/calendar?from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z";
  assert.deepEqual(
    (await (await w.request(path, { user: "viewer" })).json()).data.map((p) => p.id),
    ["start"],
  );
  for (const query of [
    "from=bad&to=bad",
    "from=2026-01-01&to=2027-01-01",
    "from=2026-11-02&to=2026-11-01",
  ])
    assert.equal((await w.request("/v1/posts/calendar?" + query, { user: "owner" })).status, 400);
  assert.equal((await w.request("/v1/posts/review?limit=101", { user: "owner" })).status, 400);
});
test("page collector handles older servers and refuses cursor loops", async () => {
  assert.equal((await collectPostPages(async () => ({ data: [{ id: "one" }] }))).length, 1);
  await assert.rejects(
    collectPostPages(async () => ({ data: [{ id: "one" }], nextCursor: "same" })),
    /Refresh/,
  );
});

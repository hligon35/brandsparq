import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import { findNextAvailableSlot } from "../cloudflare/src/scheduling.ts";

function legacyWindows(w) {
  w.exec(`UPDATE workspace_settings SET preferred_windows='["09:00-11:00","17:00-20:00"]'`);
  w.exec(
    `INSERT INTO client_settings(client_id,preferred_windows) VALUES ('client-a','["09:00-10:00"]')`,
  );
}

test("stored workspace and client preferred windows cannot shift an exact noon or minute selection", async (t) => {
  const w = workspace(t);
  legacyWindows(w);
  // Noon Eastern in winter and summer, and a non-quarter-hour picker value.
  for (const requested of [
    "2030-01-07T17:00:00.000Z",
    "2030-07-08T16:00:00.000Z",
    "2030-07-08T16:07:00.000Z",
  ])
    assert.equal(await findNextAvailableSlot(w.env, "client-a", requested), requested);
});

test("manual rescheduling persists the selected noon time without changing posting preferences", async (t) => {
  const w = workspace(t);
  legacyWindows(w);
  w.post("noon-post", "client-a", "calendar_scheduled");
  const requested = "2030-01-07T17:00:00.000Z";
  const response = await w.request("/v1/posts/noon-post/reschedule", {
    method: "POST",
    user: "owner",
    body: { scheduledPublishAt: requested },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.scheduledPublishAt, requested);
  assert.equal(result.adjusted, false);
  assert.equal(
    w.row("SELECT scheduled_publish_at FROM posts WHERE id='noon-post'").scheduled_publish_at,
    requested,
  );
  assert.equal(
    w.row("SELECT preferred_windows FROM client_settings WHERE client_id='client-a'")
      .preferred_windows,
    '["09:00-10:00"]',
  );
});

test("settings omit retired windows and older app submissions cannot reactivate them", async (t) => {
  const w = workspace(t);
  legacyWindows(w);
  const before = w.row("SELECT preferred_windows FROM workspace_settings").preferred_windows;
  const response = await w.request("/v1/settings", {
    method: "POST",
    user: "owner",
    body: { workspace: { preferredWindows: ["12:00-13:00"], maxPostsPerDay: 4 } },
  });
  assert.equal(response.status, 200);
  assert.equal(w.row("SELECT preferred_windows FROM workspace_settings").preferred_windows, before);
  assert.equal(w.row("SELECT max_posts_per_day FROM workspace_settings").max_posts_per_day, 4);
  const settings = (await (await w.request("/v1/settings", { user: "owner" })).json()).data
    .workspace;
  assert.equal(Object.hasOwn(settings, "preferred_windows"), false);
  const requested = "2030-01-07T17:00:00.000Z";
  assert.equal(await findNextAvailableSlot(w.env, "client-a", requested), requested);
});

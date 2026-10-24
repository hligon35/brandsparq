import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import { notificationRoute } from "../src/shared/notification-route.ts";

test("notification read and delete state is private to the recipient and preserves delivery audit", async (t) => {
  const w = workspace(t);
  w.exec(
    "INSERT INTO notifications(id,user_id,type,channel,status,title) VALUES ('shared',NULL,'test','in_app','sent','Shared'),('private','owner','test','in_app','sent','Private')",
  );
  let r = await w.request("/v1/notifications/shared/read", {
    user: "viewer",
    method: "POST",
    body: {},
  });
  assert.equal(r.status, 200);
  const list = async (user) => (await (await w.request("/v1/notifications", { user })).json()).data;
  assert.ok((await list("viewer")).find((n) => n.id === "shared").read_at);
  assert.equal((await list("owner")).find((n) => n.id === "shared").read_at, null);
  r = await w.request("/v1/notifications/delete", {
    user: "viewer",
    method: "POST",
    body: { ids: ["shared", "private"] },
  });
  assert.equal(r.status, 200);
  assert.equal(
    (await list("viewer")).some((n) => n.id === "shared"),
    false,
  );
  assert.equal((await list("owner")).length, 2);
  assert.equal(w.row("SELECT COUNT(*) AS count FROM notifications").count, 2);
  assert.equal(
    w.row(
      "SELECT COUNT(*) AS count FROM notification_inbox WHERE user_id='viewer' AND notification_id='private'",
    ).count,
    0,
  );
  assert.equal(
    (
      await w.request("/v1/notifications/delete", {
        user: "owner",
        method: "POST",
        body: { ids: [] },
      })
    ).status,
    400,
  );
});
test("notification navigation only opens known app destinations", () => {
  assert.equal(
    notificationRoute({ post_id: "post-1", type: "pre_publish" }),
    "/posts/post-1/publish",
  );
  assert.equal(notificationRoute({ deep_link: "brandsparq://posts/post-1" }), "/posts/post-1");
  assert.equal(
    notificationRoute({ deep_link: "https://brandsparq.getsparqd.com/calendar" }),
    "/calendar",
  );
  for (const deep_link of [
    "https://evil.test/posts/post-1",
    "//evil.test",
    "javascript:alert(1)",
    "brandsparq://unknown/path",
  ])
    assert.equal(notificationRoute({ deep_link }), null);
});

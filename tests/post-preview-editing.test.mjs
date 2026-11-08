import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";

const edit = (w, body = {}, user = "owner") =>
  w.request("/v1/posts/post/edit", {
    method: "POST",
    user,
    body: { expectedRevision: 1, caption: "Updated caption #Wellness", ...body },
  });

for (const status of [
  "awaiting_approval",
  "edit_requested",
  "calendar_scheduled",
  "rescheduled",
  "pre_publish",
]) {
  test(`${status} copy edits save without changing the selected posting time`, async (t) => {
    const w = workspace(t);
    w.post("post", "client-a", status);
    w.exec(
      "UPDATE posts SET scheduled_publish_at='2026-11-13T17:00:00.000Z',prepublish_alert_at='alert',prepublish_response='approved' WHERE id='post'",
    );
    const before = w.row("SELECT * FROM posts WHERE id='post'");
    const scheduled = ["calendar_scheduled", "rescheduled", "pre_publish"].includes(status);
    if (scheduled)
      w.exec(
        "INSERT INTO publish_jobs(id,post_id,execution_key,status) VALUES ('old-job','post','old-version','queued')",
      );
    assert.equal(
      (await edit(w, { expectedRevision: before.content_revision, comment: "Copy reviewed" }))
        .status,
      200,
    );
    const after = w.row("SELECT * FROM posts WHERE id='post'");
    assert.equal(after.caption, "Updated caption #Wellness");
    assert.equal(after.content_revision, before.content_revision + 1);
    assert.equal(after.scheduled_publish_at, before.scheduled_publish_at);
    assert.equal(after.approved_at, before.approved_at);
    assert.equal(
      after.status,
      status === "pre_publish"
        ? "calendar_scheduled"
        : status === "edit_requested"
          ? "awaiting_approval"
          : status,
    );
    assert.equal(after.publish_version, before.publish_version + Number(scheduled));
    assert.equal(w.row("SELECT COUNT(*) n FROM review_comments WHERE post_id='post'").n, 1);
    if (scheduled) {
      assert.equal(after.prepublish_alert_at, null);
      assert.equal(after.prepublish_response, null);
      assert.equal(w.row("SELECT status FROM publish_jobs WHERE id='old-job'").status, "canceled");
    }
    assert.equal(
      (await edit(w, { expectedRevision: before.content_revision, caption: "Stale copy" })).status,
      409,
    );
    assert.equal(w.row("SELECT caption FROM posts WHERE id='post'").caption, after.caption);
  });
}

test("scheduled copy requires both review and calendar permissions", async (t) => {
  const w = workspace(t);
  w.post("post");
  w.exec("UPDATE user_client_access SET permission_role='reviewer' WHERE user_id='viewer'");
  const revision = w.row("SELECT content_revision FROM posts WHERE id='post'").content_revision;
  assert.equal((await edit(w, { expectedRevision: revision }, "viewer")).status, 200);
  w.exec("UPDATE posts SET status='calendar_scheduled' WHERE id='post'");
  assert.equal((await edit(w, { expectedRevision: revision + 1 }, "viewer")).status, 403);
  w.exec("UPDATE user_client_access SET permission_role='publisher' WHERE user_id='viewer'");
  assert.equal((await edit(w, { expectedRevision: revision + 1 }, "viewer")).status, 403);
});

for (const status of [
  "publishing",
  "provider_processing",
  "publish_queued",
  "published",
  "canceled",
  "regenerating",
]) {
  test(`${status} copy cannot be changed`, async (t) => {
    const w = workspace(t);
    w.post("post", "client-a", status);
    assert.equal((await edit(w)).status, 409);
    assert.equal(w.row("SELECT caption FROM posts WHERE id='post'").caption, "Test caption");
  });
}

test("a publisher claiming the job before the edit transaction fences the edit", async (t) => {
  const w = workspace(t);
  w.post("post", "client-a", "calendar_scheduled");
  w.exec(
    "INSERT INTO publish_jobs(id,post_id,execution_key,status) VALUES ('job','post','version','queued')",
  );
  const batch = w.env.DB.batch;
  w.env.DB.batch = async (statements) => {
    w.exec("UPDATE publish_jobs SET status='publishing' WHERE id='job'");
    return batch(statements);
  };
  assert.equal(
    (
      await edit(w, {
        expectedRevision: w.row("SELECT content_revision FROM posts WHERE id='post'")
          .content_revision,
      })
    ).status,
    409,
  );
  assert.equal(w.row("SELECT caption FROM posts WHERE id='post'").caption, "Test caption");
  assert.equal(w.row("SELECT status FROM publish_jobs WHERE id='job'").status, "publishing");
});

test("an uploaded source photo gets an authorized preview without becoming publishable artwork", async (t) => {
  const w = workspace(t);
  w.post("post");
  w.exec("UPDATE posts SET graphic_key=NULL WHERE id='post'");
  w.exec(
    "INSERT INTO assets(id,client_id,r2_key,filename,content_type) VALUES ('photo','client-a','source.jpg','photo.jpg','image/jpeg')",
  );
  w.exec("INSERT INTO post_assets(post_id,asset_id) VALUES ('post','photo')");
  w.objects.set("source.jpg", "source photo bytes");
  const post = (await (await w.request("/v1/posts/post", { user: "owner" })).json()).data;
  assert.equal(post.image_url, null);
  assert.equal(post.graphic_key, null);
  assert.ok(post.source_image_url);
  const media = await w.request(new URL(post.source_image_url).pathname);
  assert.equal(media.status, 200);
  assert.equal(await media.text(), "source photo bytes");
  w.exec("UPDATE posts SET graphic_key='finished.jpg' WHERE id='post'");
  const finished = (await (await w.request("/v1/posts/post", { user: "owner" })).json()).data;
  assert.ok(finished.image_url);
  assert.equal(finished.source_image_url, null);
});

test("source preview cannot cross client boundaries or grant access to unauthorized readers", async (t) => {
  const w = workspace(t);
  w.post("post", "client-b");
  w.exec("UPDATE posts SET graphic_key=NULL WHERE id='post'");
  w.exec(
    "INSERT INTO assets(id,client_id,r2_key,filename,content_type) VALUES ('photo','client-a','private.jpg','photo.jpg','image/jpeg')",
  );
  w.exec("INSERT INTO post_assets(post_id,asset_id) VALUES ('post','photo')");
  assert.equal((await w.request("/v1/posts/post", { user: "viewer" })).status, 403);
  assert.equal(w.row("SELECT COUNT(*) n FROM media_access_tokens").n, 0);
  const post = (await (await w.request("/v1/posts/post", { user: "owner" })).json()).data;
  assert.equal(post.source_image_url, null);
});

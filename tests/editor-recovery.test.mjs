import test from "node:test";
import assert from "node:assert/strict";
import { createEditorDraft, editorDraftKey } from "../src/shared/editor-draft.ts";
import { runGuardedNavigation, interceptTabPress } from "../src/shared/guarded-navigation.ts";
import { approveSavedCopy } from "../src/shared/approve-saved-copy.ts";
import { workspace, digest } from "./workspace.mjs";
import { encryptSecret } from "../cloudflare/src/security.ts";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function deviceDraft() {
  let saved = null;
  const storage = {
    read: async () => structuredClone(saved),
    write: async (next) => {
      saved = structuredClone(next);
    },
  };
  return { storage, state: () => saved, editor: createEditorDraft(storage) };
}

test("draft identities isolate users, clients and editor types using valid native storage keys", () => {
  const keys = [
    editorDraftKey("one", "brand", "a"),
    editorDraftKey("two", "brand", "a"),
    editorDraftKey("one", "brand", "b"),
    editorDraftKey("one", "post", "a"),
    editorDraftKey("one", "brand", "a/b"),
    editorDraftKey("one", "brand", "a_00002fb"),
  ];
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every((key) => /^[a-zA-Z0-9_.-]+$/.test(key)));
});

test("unsaved fields survive process restart without changing server data", async () => {
  const w = deviceDraft();
  const baseline = { voice: "Saved voice", colors: ["#FFFFFF"] };
  await w.editor.initialize(baseline);
  w.editor.update({ ...baseline, voice: "Local voice" });
  await w.editor.flush();
  const next = createEditorDraft(w.storage);
  const recovered = await next.initialize(baseline, { recover: true });
  assert.equal(recovered.value.voice, "Local voice");
  assert.equal(recovered.pending, false);
  assert.equal(baseline.voice, "Saved voice");
});

test("newer server changes preserve the old draft until an explicit recovery choice", async () => {
  const w = deviceDraft();
  await w.editor.initialize({ caption: "Original" });
  w.editor.update({ caption: "Local edits" });
  await w.editor.flush();
  const stored = structuredClone(w.state());
  const next = createEditorDraft(w.storage);
  const recovered = await next.initialize({ caption: "Newer saved copy" }, { recover: true });
  assert.equal(recovered.pending, true);
  assert.equal(recovered.value.caption, "Newer saved copy");
  next.update({ caption: "Must not overwrite pending recovery" });
  await next.flush();
  assert.deepEqual(w.state(), stored);
  assert.equal(next.chooseRecovered(true).caption, "Local edits");
  await next.flush();
  assert.equal(w.state().baseline.caption, "Newer saved copy");
  assert.equal(w.state().value.caption, "Local edits");
});

test("discarding a stale recovered draft keeps latest saved fields and removes the local copy", async () => {
  const w = deviceDraft();
  await w.editor.initialize({ notes: "Saved" });
  w.editor.update({ notes: "Draft" });
  await w.editor.flush();
  const next = createEditorDraft(w.storage);
  await next.initialize({ notes: "Latest" }, { recover: true });
  assert.equal(next.chooseRecovered(false).notes, "Latest");
  await next.flush();
  assert.equal(w.state(), null);
});

test("a confirmed save clears recovery data; saving a palette preserves other unsaved fields", async () => {
  const w = deviceDraft();
  await w.editor.initialize({ voice: "Saved", color: "#000000" });
  w.editor.update({ voice: "Unsaved voice", color: "#FFFFFF" });
  w.editor.markSaved({ voice: "Saved", color: "#FFFFFF" });
  await w.editor.flush();
  assert.equal(w.state().value.voice, "Unsaved voice");
  assert.equal(w.state().baseline.color, "#FFFFFF");
  w.editor.markSaved({ voice: "Unsaved voice", color: "#FFFFFF" });
  await w.editor.flush();
  assert.equal(w.state(), null);
});

test("read-only initialization cannot restore or clear an existing private draft", async () => {
  const w = deviceDraft();
  await w.editor.initialize({ caption: "Saved" });
  w.editor.update({ caption: "Private edits" });
  await w.editor.flush();
  const before = structuredClone(w.state());
  const next = createEditorDraft(w.storage);
  await next.initialize({ caption: "Server" }, { persist: false, clear: false });
  await next.flush();
  assert.deepEqual(w.state(), before);
});

test("malformed stored fields cannot be rendered as native input values", async () => {
  for (const value of [{ caption: {} }, { caption: "text", extra: true }, { caption: [{}] }]) {
    const editor = createEditorDraft({
      read: async () => ({ version: 1, baseline: { caption: "Saved" }, value }),
      write: async () => {},
    });
    const result = await editor.initialize({ caption: "Saved" }, { recover: true });
    assert.equal(result.value.caption, "Saved");
    assert.match(result.notice, /incompatible/);
  }
});

test("late restoration cannot update a closed or replaced editor", async () => {
  const gate = deferred();
  const editor = createEditorDraft({ read: () => gate.promise, write: async () => {} });
  const pending = editor.initialize({ name: "Server" }, { recover: true });
  editor.close();
  gate.resolve({ version: 1, baseline: { name: "Server" }, value: { name: "Old user draft" } });
  assert.equal(await pending, null);
});

test("draft writes coalesce and explicit reload finishes after pending writes", async () => {
  const gate = deferred();
  const writes = [];
  let blocked = true;
  const editor = createEditorDraft({
    read: async () => null,
    write: async (value) => {
      if (value && blocked) {
        blocked = false;
        await gate.promise;
      }
      writes.push(value);
    },
  });
  await editor.initialize({ caption: "Saved" });
  writes.length = 0;
  editor.update({ caption: "first" });
  const first = editor.flush();
  editor.update({ caption: "second" });
  const second = editor.flush();
  editor.update({ caption: "last" });
  const last = editor.flush();
  gate.resolve();
  await Promise.all([first, second, last]);
  assert.deepEqual(
    writes.map((v) => v.value.caption),
    ["first", "last"],
  );
  await editor.initialize({ caption: "Server latest" });
  await editor.flush();
  assert.equal(writes.at(-1), null);
});

test("storage read failures show the saved version and a recoverable notice", async () => {
  const editor = createEditorDraft({
    read: async () => {
      throw Error("locked");
    },
    write: async () => {},
  });
  const result = await editor.initialize({ caption: "Server" }, { recover: true });
  assert.equal(result.value.caption, "Server");
  assert.match(result.notice, /could not/);
});

test("guarded tab navigation honors Keep editing and serializes duplicate taps", async () => {
  const gate = deferred();
  let prompts = 0,
    moves = 0,
    prevented = 0;
  const guard = {
    current: {
      dirty: () => true,
      leave: () => {
        prompts++;
        return gate.promise;
      },
    },
  };
  interceptTabPress(
    {
      preventDefault() {
        prevented++;
      },
    },
    guard,
    () => moves++,
    false,
  );
  interceptTabPress(
    {
      preventDefault() {
        prevented++;
      },
    },
    guard,
    () => moves++,
    false,
  );
  gate.resolve(false);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(prompts, 1);
  assert.equal(moves, 0);
  assert.equal(prevented, 2);
  guard.current.leave = async () => true;
  await runGuardedNavigation(guard, () => moves++);
  assert.equal(moves, 1);
  interceptTabPress(
    {
      preventDefault() {
        throw Error("already focused");
      },
    },
    guard,
    () => moves++,
    true,
  );
  assert.equal(moves, 1);
});

test("a lost approval response is reconciled only for the exact approved revision", async () => {
  let requests = 0;
  const error = Error("response lost");
  await approveSavedCopy(
    7,
    async () => {
      requests++;
      throw error;
    },
    async () => ({ revision: 7, approvedAt: "now", status: "calendar_scheduled" }),
  );
  assert.equal(requests, 1);
  for (const current of [
    { revision: 8, approvedAt: "now", status: "calendar_scheduled" },
    { revision: 7, status: "awaiting_approval" },
    { revision: 7, approvedAt: "now", status: "paused" },
  ]) {
    await assert.rejects(
      approveSavedCopy(
        7,
        async () => {
          throw error;
        },
        async () => current,
      ),
      /response lost/,
    );
  }
});

test("a real approval with a lost response is confirmed once for its saved caption revision", async (t) => {
  const w = workspace(t);
  w.post("post");
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,health_status,access_token_ciphertext,is_default) VALUES ('social','client-a','facebook','page','connected','healthy',?,1)",
    await encryptSecret("fixture", w.env),
  );
  w.exec("UPDATE posts SET social_account_id='social' WHERE id='post'");
  const before = w.row("SELECT content_revision FROM posts WHERE id='post'").content_revision;
  const savedResponse = await w.request("/v1/posts/post/edit", {
    user: "owner",
    method: "POST",
    body: { caption: "Confirmed outgoing copy", expectedRevision: before },
  });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  let attempts = 0;
  await approveSavedCopy(
    saved.revision,
    async (revision) => {
      attempts++;
      const response = await w.request("/v1/posts/post/approve", {
        user: "owner",
        method: "POST",
        body: { expectedRevision: revision },
      });
      assert.equal(response.status, 200);
      throw Error("response lost after commit");
    },
    async () => {
      const { data } = await (await w.request("/v1/posts/post", { user: "owner" })).json();
      return { revision: data.content_revision, approvedAt: data.approved_at, status: data.status };
    },
  );
  assert.equal(attempts, 1);
  assert.equal(w.row("SELECT COUNT(*) n FROM approvals WHERE post_id='post'").n, 1);
  assert.equal(
    w.row("SELECT caption FROM posts WHERE id='post'").caption,
    "Confirmed outgoing copy",
  );
});

function review(w) {
  w.exec(
    "INSERT INTO review_tokens(id,post_id,token_hash,recipient_email,expires_at,created_at) VALUES ('review','post',?,'reviewer@example.test',?,?)",
    digest(`${w.env.AUTH_PEPPER}:review:review-key`),
    Date.now() + 3600000,
    Date.now(),
  );
}
function source(w, client = "client-a") {
  w.exec(
    "INSERT INTO assets(id,client_id,r2_key,filename,content_type) VALUES ('source',?,'source.jpg','photo.jpg','image/jpeg')",
    client,
  );
  w.exec("INSERT INTO post_assets(post_id,asset_id) VALUES ('post','source')");
  w.objects.set("source.jpg", "source image bytes");
}

test("public source previews require a valid review token and never become final artwork", async (t) => {
  const w = workspace(t);
  w.post("post");
  w.exec("UPDATE posts SET graphic_key=NULL WHERE id='post'");
  source(w);
  review(w);
  const post = (await (await w.request("/v1/public/review/review-key")).json()).data;
  assert.equal(post.image_url, null);
  assert.equal(post.artwork_ready, false);
  assert.ok(post.source_image_url);
  const image = await w.request(post.source_image_url + "?preview=retry");
  assert.equal(image.status, 200);
  assert.equal(await image.text(), "source image bytes");
  assert.equal(w.row("SELECT graphic_key FROM posts WHERE id='post'").graphic_key, null);
  assert.equal((await w.request("/v1/public/review/wrong/source-media")).status, 404);
  w.exec("UPDATE review_tokens SET revoked_at=? WHERE id='review'", Date.now());
  assert.equal((await w.request(post.source_image_url)).status, 404);
});

test("public previews cannot follow a source asset from a different client", async (t) => {
  const w = workspace(t);
  w.post("post");
  w.exec("UPDATE posts SET graphic_key=NULL WHERE id='post'");
  source(w, "client-b");
  review(w);
  const post = (await (await w.request("/v1/public/review/review-key")).json()).data;
  assert.equal(post.source_image_url, null);
  assert.equal((await w.request("/v1/public/review/review-key/source-media")).status, 404);
});

test("deleted final graphics fall back to source previews on private and public review", async (t) => {
  const w = workspace(t);
  w.post("post");
  w.objects.delete("fixture/post.jpg");
  source(w);
  review(w);
  const publicPost = (await (await w.request("/v1/public/review/review-key")).json()).data;
  const privatePost = (await (await w.request("/v1/posts/post", { user: "owner" })).json()).data;
  for (const post of [publicPost, privatePost]) {
    assert.equal(post.artwork_ready, false);
    assert.equal(post.image_url, null);
    assert.ok(post.source_image_url);
  }
  w.exec("UPDATE review_tokens SET expires_at=1 WHERE id='review'");
  assert.equal((await w.request(publicPost.source_image_url)).status, 404);
});

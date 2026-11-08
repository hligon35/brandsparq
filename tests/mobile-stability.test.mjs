import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { workspace, digest } from "./workspace.mjs";
import { createPushCleanupStore } from "../src/notifications/device-store.ts";
import { prepareImageUpload } from "../src/shared/prepare-image-upload.ts";
import { uploadBatch } from "../src/shared/upload-batch.ts";
import { ensurePublishJob } from "../cloudflare/src/publishing.ts";
import { reserveSchedule } from "../cloudflare/src/scheduling.ts";
import { encryptSecret } from "../cloudflare/src/security.ts";

function storedDevice() {
  let saved = null;
  const storage = {
    read: async () => structuredClone(saved),
    write: async (value) => {
      saved = structuredClone(value);
    },
  };
  return { storage, state: () => saved, device: createPushCleanupStore(storage) };
}
const prepare = async () => ({ cleanupToken: "a".repeat(64) });

test("offline sign-out survives process restart and retries without login credentials", async () => {
  const w = storedDevice();
  await w.device.register(
    "device",
    "old-user",
    prepare,
    async () => {},
    () => true,
  );
  await w.device.unregister("old-user", async () => {
    throw new Error("offline");
  });
  assert.equal(w.state().current, undefined);
  assert.equal(w.state().pending.length, 1);
  const restarted = createPushCleanupStore(w.storage);
  const revoked = [];
  await restarted.retry(async (entry) => {
    revoked.push(entry);
  });
  assert.equal(revoked[0].cleanupToken, "a".repeat(64));
  assert.equal(revoked[0].userId, "old-user");
  assert.deepEqual(w.state().pending, []);
});

test("cleanup is durable before activation, including a lost activation response", async () => {
  const w = storedDevice();
  await assert.rejects(
    w.device.register(
      "device",
      "owner",
      prepare,
      async () => {
        assert.equal(w.state().current.cleanupToken, "a".repeat(64));
        throw new Error("response lost");
      },
      () => true,
    ),
    /response lost/,
  );
  await w.device.unregister("owner", async () => {
    throw new Error("offline");
  });
  assert.equal(w.state().pending[0].token, "device");
});

test("storage failure or sign-out during prepare cannot activate a device", async () => {
  let sent = false,
    current = true;
  const w = storedDevice();
  await assert.rejects(
    w.device.register(
      "device",
      "owner",
      async () => {
        current = false;
        return prepare();
      },
      async () => {
        sent = true;
      },
      () => current,
    ),
    /sign-in changed/,
  );
  assert.equal(sent, false);
  const broken = createPushCleanupStore({
    read: async () => null,
    write: async () => {
      throw new Error("storage full");
    },
  });
  await assert.rejects(
    broken.register(
      "device",
      "owner",
      prepare,
      async () => {
        sent = true;
      },
      () => true,
    ),
    /storage full/,
  );
  assert.equal(sent, false);
});

test("a failed sign-out storage write leaves an orphan that a signed-out restart can revoke", async () => {
  const w = storedDevice();
  await w.device.register(
    "device",
    "old-user",
    prepare,
    async () => {},
    () => true,
  );
  const broken = createPushCleanupStore({
    read: w.storage.read,
    write: async () => {
      throw Error("storage full");
    },
  });
  await broken.unregister("old-user", async () => {
    throw Error("offline");
  });
  assert.equal(w.state().current.token, "device");
  const restarted = createPushCleanupStore(w.storage);
  let revoked;
  await restarted.retry(async (entry) => {
    revoked = entry;
  });
  assert.equal(revoked.token, "device");
  assert.equal(w.state().current, undefined);
  assert.deepEqual(w.state().pending, []);
});

test("registration waits for old cleanup and a delayed cleanup retains its old proof", async () => {
  const w = storedDevice();
  await w.device.register(
    "old-device",
    "old-user",
    prepare,
    async () => {},
    () => true,
  );
  let release, started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const clearing = w.device.unregister("old-user", async () => {
    started();
    await gate;
    throw Error("offline");
  });
  await began;
  let activated = false;
  const registration = w.device.register(
    "new-device",
    "new-user",
    async () => ({ cleanupToken: "b".repeat(64) }),
    async () => {
      activated = true;
    },
    () => true,
  );
  assert.equal(activated, false);
  release();
  await Promise.all([clearing, registration]);
  const proofs = [];
  await w.device.retry(async (entry) => {
    proofs.push(entry);
  }, "new-user");
  assert.equal(proofs[0].token, "old-device");
  assert.equal(proofs[0].cleanupToken, "a".repeat(64));
  assert.equal(w.state().current.userId, "new-user");
});

async function request(w, path, body, user = "owner") {
  return w.request(path, { method: "POST", user, body });
}
async function registerDevice(w, user = "owner") {
  const response = await request(w, "/v1/push-token/prepare", { token: "device" }, user);
  assert.equal(response.status, 200);
  const { cleanupToken } = await response.json();
  assert.equal(
    (await request(w, "/v1/push-token", { token: "device", cleanupToken, platform: "ios" }, user))
      .status,
    200,
  );
  return cleanupToken;
}

test("device cleanup works after session revocation and cannot disable a new account registration", async (t) => {
  const w = workspace(t);
  const old = await registerDevice(w);
  assert.notEqual(
    w.row("SELECT cleanup_token_hash FROM device_push_tokens").cleanup_token_hash,
    old,
  );
  assert.equal(w.row("SELECT enabled FROM device_push_tokens").enabled, 1);
  w.exec("UPDATE sessions SET revoked_at=? WHERE user_id='owner'", Date.now());
  const next = await registerDevice(w, "viewer");
  // An old account-scoped cleanup cannot revoke a newer capability registration,
  // even if the same account signs in again on this device.
  await request(w, "/v1/push-token/unregister", { token: "device" }, "viewer");
  assert.equal(w.row("SELECT enabled FROM device_push_tokens").enabled, 1);
  assert.equal(
    (
      await request(
        w,
        "/v1/public/push-token/unregister",
        { token: "device", cleanupToken: old },
        null,
      )
    ).status,
    200,
  );
  assert.equal(w.row("SELECT enabled FROM device_push_tokens").enabled, 1);
  await request(
    w,
    "/v1/public/push-token/unregister",
    { token: "other-device", cleanupToken: next },
    null,
  );
  assert.equal(w.row("SELECT enabled FROM device_push_tokens").enabled, 1);
  await request(
    w,
    "/v1/public/push-token/unregister",
    { token: "device", cleanupToken: next },
    null,
  );
  assert.equal(w.row("SELECT enabled FROM device_push_tokens").enabled, 0);
  assert.equal(w.row("SELECT cleanup_token_hash FROM device_push_tokens").cleanup_token_hash, null);
  assert.equal(
    (await request(w, "/v1/push-token", { token: "device", cleanupToken: next }, "viewer")).status,
    409,
  );
});

test("prepared devices stay disabled and reject mismatched activation credentials", async (t) => {
  const w = workspace(t);
  const response = await request(w, "/v1/push-token/prepare", { token: "device" });
  const { cleanupToken } = await response.json();
  assert.equal(w.row("SELECT enabled FROM device_push_tokens").enabled, 0);
  assert.equal(
    (await request(w, "/v1/push-token", { token: "device", cleanupToken }, "viewer")).status,
    409,
  );
  assert.equal(
    (
      await request(
        w,
        "/v1/public/push-token/unregister",
        { token: "device", cleanupToken: "wrong" },
        null,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request(w, "/v1/push-token/prepare", { token: "another" }, null)).status,
    401,
  );
});

async function reviewWorkspace(t) {
  const w = workspace(t);
  w.post("missing");
  w.post("ready");
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,health_status,access_token_ciphertext,is_default) VALUES ('social','client-a','facebook','page','connected','healthy',?,1)",
    await encryptSecret("fixture", w.env),
  );
  w.exec("UPDATE posts SET social_account_id='social'");
  w.exec("UPDATE posts SET graphic_key=NULL WHERE id='missing'");
  return w;
}
const revision = (w, id) =>
  w.row("SELECT content_revision FROM posts WHERE id=?", id).content_revision;

test("individual and public approvals reject missing artwork without consuming review tokens", async (t) => {
  const w = await reviewWorkspace(t);
  let response = await request(w, "/v1/posts/missing/approve", {
    expectedRevision: revision(w, "missing"),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /artwork/);
  w.exec(
    "INSERT INTO review_tokens(id,post_id,token_hash,recipient_email,expires_at,created_at) VALUES ('review','missing',?,'reviewer@example.test',?,?)",
    digest(`${w.env.AUTH_PEPPER}:review:review-key`),
    Date.now() + 3600000,
    Date.now(),
  );
  response = await request(
    w,
    "/v1/public/review/review-key/approve",
    { expectedRevision: revision(w, "missing") },
    null,
  );
  assert.equal(response.status, 409);
  assert.equal(w.row("SELECT used_at FROM review_tokens WHERE id='review'").used_at, null);
  assert.equal(w.row("SELECT status FROM posts WHERE id='missing'").status, "awaiting_approval");
});

test("bulk approvals report missing images individually and schedule ready posts", async (t) => {
  const w = await reviewWorkspace(t);
  const response = await request(w, "/v1/posts/bulk/approve", {
    postIds: ["missing", "ready"],
    expectedRevisions: { missing: revision(w, "missing"), ready: revision(w, "ready") },
  });
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.equal(results.find((p) => p.postId === "missing").ok, false);
  assert.match(results.find((p) => p.postId === "missing").error, /artwork/);
  assert.equal(results.find((p) => p.postId === "ready").ok, true);
});

test("deleted final artwork, resume and publish queue creation fail closed", async (t) => {
  const w = await reviewWorkspace(t);
  w.objects.delete("fixture/ready.jpg");
  assert.equal(
    (await request(w, "/v1/posts/ready/approve", { expectedRevision: revision(w, "ready") }))
      .status,
    409,
  );
  await assert.rejects(ensurePublishJob(w.env, "missing"), /artwork/);
  const before = w.row("SELECT * FROM posts WHERE id='missing'");
  await assert.rejects(
    reserveSchedule(w.env, "missing", {
      clientId: "client-a",
      status: before.status,
      publishVersion: before.publish_version,
      desiredAt: before.suggested_publish_at,
      resume: true,
    }),
    /artwork/,
  );
  assert.equal(w.row("SELECT COUNT(*) n FROM publish_jobs").n, 0);
});

test("Publish Now with missing artwork preserves the existing status and selected schedule", async (t) => {
  const w = await reviewWorkspace(t);
  w.exec(
    "UPDATE posts SET status='calendar_scheduled',approved_at=CURRENT_TIMESTAMP,scheduled_publish_at='2030-01-07T17:00:00.000Z' WHERE id='missing'",
  );
  const response = await request(w, "/v1/posts/missing/publish-now", {});
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /artwork/);
  const post = w.row("SELECT status,scheduled_publish_at FROM posts WHERE id='missing'");
  assert.equal(post.status, "calendar_scheduled");
  assert.equal(post.scheduled_publish_at, "2030-01-07T17:00:00.000Z");
  assert.equal(w.published.length, 0);
});

test("large photos are resized before Blob creation and PNG transparency is retained", async () => {
  const calls = [];
  const result = await prepareImageUpload(
    {
      uri: "file://photo.heic",
      filename: "photo.heic",
      contentType: "image/heic",
      width: 8000,
      height: 6000,
    },
    {
      dimensions: async () => {
        throw Error("metadata already available");
      },
      resize: async (uri, edge, format, dimensions) => {
        calls.push({ uri, edge, format, dimensions });
        return { uri: "file://prepared.jpg", width: 2000, height: 1500 };
      },
      blob: async (uri) => {
        assert.equal(uri, "file://prepared.jpg");
        return new Blob(["image"]);
      },
    },
  );
  assert.equal(result.contentType, "image/jpeg");
  assert.equal(result.filename, "photo.jpg");
  assert.equal(calls[0].edge, 2000);
  await prepareImageUpload(
    { uri: "logo", filename: "logo.png", contentType: "image/png" },
    {
      dimensions: async () => ({ width: 400, height: 400 }),
      resize: async (_uri, _edge, format) => {
        assert.equal(format, "png");
        return { uri: "png", width: 400, height: 400 };
      },
      blob: async () => new Blob(["transparent PNG"]),
    },
  );
});

test("oversize prepared images get one smaller attempt; invalid dimensions never reach processing", async () => {
  const edges = [];
  const adapter = {
    dimensions: async () => ({ width: 8000, height: 6000 }),
    resize: async (_uri, edge) => {
      edges.push(edge);
      return { uri: String(edge), width: edge, height: edge };
    },
    blob: async (uri) => ({ size: uri === "2000" ? 9 * 1024 * 1024 : 100 }),
  };
  assert.equal(
    (
      await prepareImageUpload(
        { uri: "image", filename: "image.jpg", contentType: "image/jpeg" },
        adapter,
      )
    ).width,
    1200,
  );
  assert.deepEqual(edges, [2000, 1200]);
  await assert.rejects(
    prepareImageUpload(
      { uri: "bad", filename: "bad", contentType: "image/jpeg" },
      { ...adapter, dimensions: async () => ({ width: NaN, height: 1 }) },
    ),
    /dimensions/,
  );
});

test("native upload batches never process two full-size sources together", async () => {
  const items = [1, 2, 3].map((source) => ({ source, key: String(source), status: "pending" }));
  let active = 0,
    peak = 0;
  await uploadBatch(
    items,
    async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    },
    () => {},
    1,
  );
  assert.equal(peak, 1);
  assert.ok(items.every((item) => item.status === "ready"));
});

test("native container children never contain bare text or literal spacing", () => {
  const invalid = [];
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) scan(path);
      else if (path.endsWith(".tsx")) {
        const source = ts.createSourceFile(
          path,
          readFileSync(path, "utf8"),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
        function visit(node) {
          if (
            ts.isJsxElement(node) &&
            ["View", "ScrollView", "Pressable", "KeyboardAvoidingView", "SafeAreaView"].includes(
              node.openingElement.tagName.getText(source),
            )
          ) {
            for (const child of node.children) {
              if (
                (ts.isJsxText(child) && child.getText(source).trim()) ||
                (ts.isJsxExpression(child) &&
                  child.expression &&
                  (ts.isStringLiteral(child.expression) || ts.isNumericLiteral(child.expression)))
              )
                invalid.push(
                  `${path}:${source.getLineAndCharacterOfPosition(child.getStart(source)).line + 1}`,
                );
            }
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  scan("app");
  scan("src");
  assert.deepEqual(invalid, []);
});

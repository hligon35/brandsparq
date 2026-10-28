import test from "node:test";
import assert from "node:assert/strict";
import { workspace } from "./workspace.mjs";
import worker from "../cloudflare/src/index.ts";
import { encryptSecret } from "../cloudflare/src/security.ts";
import { publishPostToSocial, ensurePostSocialDestination } from "../cloudflare/src/social.ts";
import { providerFetch } from "../cloudflare/src/provider-http.ts";
import { renderFinalCopy, finalCopyError, copyLength } from "../src/shared/final-copy.ts";
test("final copy deduplicates hashtags and validates the complete Unicode and URL budget", () => {
  assert.equal(
    renderFinalCopy("Hello #Local", ["local", "#Brand", "Brand"]),
    "Hello #Local\n\n#Brand",
  );
  assert.equal(copyLength("x", "https://example.test/a-very-long-link"), 23);
  assert.equal(copyLength("x", "👨‍👩‍👧‍👦"), 2);
  assert.ok(finalCopyError("x", renderFinalCopy("A".repeat(278), ["Tag"])));
  assert.equal(finalCopyError("x", "A".repeat(280)), null);
});
async function social(w, platform = "facebook", expires = null) {
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,external_account_id,status,access_token_ciphertext,refresh_token_ciphertext,token_expires_at) VALUES ('account','client-a',?,'provider','connected',?,?,?)",
    platform,
    await encryptSecret("access", w.env),
    await encryptSecret("refresh", w.env),
    expires,
  );
}
test("outbound Facebook payload includes the exact reviewed caption and hashtags", async (t) => {
  const w = workspace(t);
  await social(w);
  w.post("post");
  w.exec(
    "UPDATE posts SET social_account_id='account',graphic_key='graphic.jpg',caption='Approved copy',hashtags='[\"#Local\"]' WHERE id='post'",
  );
  let caption;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    caption = init.body.get("caption");
    return Response.json({ post_id: "receipt" });
  });
  await publishPostToSocial(w.env, "post");
  assert.equal(caption, "Approved copy\n\n#Local");
});
test("oversized X copy is rejected before provider side effects or approval", async (t) => {
  const w = workspace(t);
  await social(w, "x");
  w.post("post");
  w.exec(
    "UPDATE posts SET platform='x',social_account_id='account',graphic_key='graphic.jpg',caption=? WHERE id='post'",
    "A".repeat(281),
  );
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("Must not call provider");
  });
  await assert.rejects(publishPostToSocial(w.env, "post"), /limit/);
  assert.equal(calls, 0);
  const rev = w.row("SELECT content_revision n FROM posts WHERE id='post'").n;
  assert.equal(
    (
      await w.request("/v1/posts/post/approve", {
        user: "owner",
        method: "POST",
        body: { expectedRevision: rev },
      })
    ).status,
    409,
  );
});
test("an expired refreshable destination renews before readiness excludes it", async (t) => {
  const w = workspace(t);
  await social(w, "x", Date.now() - 1000);
  w.post("post");
  w.exec("UPDATE posts SET platform='x',social_account_id='account' WHERE id='post'");
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ access_token: "renewed", expires_in: 3600 }),
  );
  const destination = await ensurePostSocialDestination(w.env, {
    id: "post",
    client_id: "client-a",
    platform: "x",
    social_account_id: "account",
  });
  assert.equal(destination.id, "account");
});
test("imminent rescheduled alert is reachable past 100 future calendar rows", async (t) => {
  const w = workspace(t);
  for (let i = 0; i < 100; i++) {
    w.post("future-" + i, "client-a", "calendar_scheduled");
    w.exec(
      "UPDATE posts SET scheduled_publish_at=? WHERE id=?",
      new Date(Date.now() + 7 * 86400000).toISOString(),
      "future-" + i,
    );
  }
  w.post("urgent", "client-a", "rescheduled");
  w.exec(
    "UPDATE posts SET scheduled_publish_at=? WHERE id='urgent'",
    new Date(Date.now() + 300000).toISOString(),
  );
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "mail" }));
  await worker.scheduled({}, w.env);
  assert.ok(w.row("SELECT prepublish_alert_at FROM posts WHERE id='urgent'").prepublish_alert_at);
});
test("provider deadline includes a stalled response body", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start() {} })));
  await assert.rejects(providerFetch("https://fixture.test", {}, 10), /too long/);
});
test("ambiguous final submission remains non-retryable", async (t) => {
  const w = workspace(t);
  await social(w);
  w.post("post");
  w.exec("UPDATE posts SET social_account_id='account',graphic_key='graphic.jpg' WHERE id='post'");
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("Lost response");
  });
  await assert.rejects(
    publishPostToSocial(w.env, "post"),
    (e) => e.category === "uncertain" && !e.retryable,
  );
});
test("a pre-publish outbox failure is recoverable on the next cron", async (t) => {
  const w = workspace(t);
  w.post("alert", "client-a", "calendar_scheduled");
  w.exec(
    "UPDATE posts SET scheduled_publish_at=? WHERE id='alert'",
    new Date(Date.now() + 300000).toISOString(),
  );
  const prepare = w.env.DB.prepare;
  let fail = true;
  w.env.DB.prepare = (sql) => {
    const wrap = (s) => ({
      ...s,
      bind(...args) {
        return wrap(s.bind(...args));
      },
      async run() {
        if (fail && /INSERT INTO notifications/.test(sql)) {
          fail = false;
          throw Error("Outbox temporarily unavailable");
        }
        return s.run();
      },
    });
    return wrap(prepare(sql));
  };
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "mail" }));
  await worker.scheduled({}, w.env);
  assert.equal(
    w.row("SELECT prepublish_alert_at FROM posts WHERE id='alert'").prepublish_alert_at,
    null,
  );
  await worker.scheduled({}, w.env);
  assert.ok(w.row("SELECT prepublish_alert_at FROM posts WHERE id='alert'").prepublish_alert_at);
});
test("editing final copy can remove all hashtags and preserve intentional whitespace", async (t) => {
  const w = workspace(t);
  w.post("post");
  w.exec("UPDATE posts SET hashtags='[\"#Old\"]' WHERE id='post'");
  let revision = w.row("SELECT content_revision n FROM posts WHERE id='post'").n;
  let response = await w.request("/v1/posts/post/edit", {
    user: "owner",
    method: "POST",
    body: { expectedRevision: revision, caption: "  Exact copy  ", hashtags: [] },
  });
  assert.equal(response.status, 200);
  assert.equal(w.row("SELECT caption FROM posts WHERE id='post'").caption, "  Exact copy  ");
  revision = (await response.json()).revision;
  response = await w.request("/v1/posts/post/edit", {
    user: "owner",
    method: "POST",
    body: { expectedRevision: revision, caption: "", hashtags: [] },
  });
  assert.equal(response.status, 200);
  assert.equal(w.row("SELECT caption FROM posts WHERE id='post'").caption, "");
});
test("minute scheduling does not wait for a stalled maintenance query", {
  timeout: 5000,
}, async (t) => {
  const w = workspace(t);
  const original = w.env.DB.prepare;
  let release;
  const held = new Promise((r) => (release = r));
  let blocked = false;
  w.env.DB.prepare = (sql) => {
    const wrap = (s) => ({
      ...s,
      bind(...args) {
        return wrap(s.bind(...args));
      },
      async all() {
        if (sql.includes("FROM notification_deliveries d JOIN notifications")) {
          blocked = true;
          await held;
        }
        return s.all();
      },
    });
    return wrap(original(sql));
  };
  const background = [];
  await worker.scheduled({}, w.env, { waitUntil: (p) => background.push(p) });
  assert.equal(background.length, 1);
  assert.equal(blocked, true);
  release();
  await Promise.all(background);
});

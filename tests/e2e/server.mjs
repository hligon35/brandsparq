import http from "node:http";
import { loadStaticAssets } from "./static-assets.mjs";
import { createSerialQueue } from "../../src/shared/serial-queue.ts";
import path from "node:path";
import worker from "../../cloudflare/src/index.ts";
import { encryptSecret } from "../../cloudflare/src/security.ts";
import { workspace, digest } from "../workspace.mjs";
import { syncAccountAnalytics } from "../../cloudflare/src/social.ts";

const port = Number(process.env.BRANDSPARQ_TEST_PORT || 8788);
const base = `http://127.0.0.1:${port}`;
const staticAsset = loadStaticAssets(path.resolve("dist"));
const serializeBackend = createSerialQueue();
let closeWorkspace;
let w;

// This server is test-only, binds loopback and never contacts real providers.
// No fixture routes, test users or network substitutions ship in the Worker.
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url || input.toString());
  if (url.hostname === "graph.facebook.com") {
    if (url.pathname.endsWith("/photos"))
      return Response.json({ id: "fixture-photo", post_id: "fixture-facebook-post" });
    if (url.pathname.endsWith("/insights"))
      return Response.json({
        data: [
          { name: "post_media_view", values: [{ value: 120 }] },
          { name: "post_total_media_view_unique", values: [{ value: 100 }] },
          { name: "post_clicks", values: [{ value: 7 }] },
          { name: "post_reactions_by_type_total", values: [{ value: { like: 12 } }] },
        ],
      });
    return Response.json({ comments: { summary: { total_count: 2 } }, shares: { count: 3 } });
  }
  if (url.hostname === "api.resend.com") return Response.json({ id: "fixture-email" });
  throw new Error(
    `Unmocked external request blocked: ${url.origin}${url.pathname} (${init.method || "GET"})`,
  );
};

async function reset() {
  closeWorkspace?.();
  w = workspace({
    after(fn) {
      closeWorkspace = fn;
    },
  });
  w.env.PUBLIC_BASE_URL = base;
  w.env.REVIEW_BASE_URL = base;
  w.env.GOOGLE_REDIRECT_URI = `${base}/v1/auth/google/callback`;
  w.env.ENVIRONMENT = "development";
  w.env.META_APP_ID = "fixture-meta";
  w.env.META_APP_SECRET = "fixture-meta-secret";
  w.exec(
    "INSERT INTO brand_profiles(id,client_id,voice,audience) VALUES('fixture-brand','client-a','Clear and helpful','Local customers')",
  );
  w.exec(
    "INSERT INTO campaigns(id,client_id,name,objective,status,notes,priority) VALUES ('fixture-campaign','client-a','Community campaign','Awareness','active','Initial notes',3)",
  );
  w.exec(
    "INSERT INTO generation_jobs(id,client_id,asset_ids,status,stage,error_message,campaign_id) VALUES ('fixture-generation','client-a','[]','failed','planning','Fixture generation failure','fixture-campaign')",
  );
  w.post("fixture-post");
  w.exec("UPDATE posts SET campaign_id='fixture-campaign' WHERE id='fixture-post'");
  w.exec(
    "UPDATE posts SET title='Launch campaign',headline='Launch campaign',graphic_key='fixture.jpg',suggested_publish_at=? WHERE id='fixture-post'",
    new Date(Date.now() + 3600000).toISOString(),
  );
  w.objects.set(
    "fixture.jpg",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmMQ0bD5DwACRAF41rdyCgAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  w.exec(
    "INSERT INTO social_accounts(id,client_id,platform,account_name,external_account_id,status,access_token_ciphertext) VALUES ('fixture-social','client-a','facebook','Test Facebook Page','fixture-page','connected',?)",
    await encryptSecret("fixture-provider-token", w.env),
  );
  w.exec("UPDATE posts SET social_account_id='fixture-social' WHERE id='fixture-post'");
  w.exec(
    "INSERT INTO google_auth_handoffs(id,user_id,handoff_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
    "fixture-handoff",
    "owner",
    digest(`${w.env.AUTH_PEPPER}:google-handoff:fixture-handoff`),
    Date.now() + 3600000,
    Date.now(),
  );
  w.exec(
    "INSERT INTO google_auth_handoffs(id,user_id,handoff_hash,expires_at,created_at) VALUES ('viewer-handoff','viewer',?,?,?)",
    digest(`${w.env.AUTH_PEPPER}:google-handoff:viewer-handoff`),
    Date.now() + 3600000,
    Date.now(),
  );
  w.exec(
    "INSERT INTO review_tokens(id,post_id,token_hash,recipient_email,expires_at,created_at) VALUES (?,?,?,?,?,?)",
    "fixture-review",
    "fixture-post",
    digest(`${w.env.AUTH_PEPPER}:review:fixture-review`),
    "reviewer@example.test",
    Date.now() + 3600000,
    Date.now(),
  );
}
await reset();

const server = http.createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, base);
    if (
      url.pathname.startsWith("/__test/") ||
      url.pathname === "/health" ||
      url.pathname.startsWith("/v1/")
    ) {
      await serializeBackend(async () => {
        if (url.pathname.startsWith("/__test/")) {
          if (incoming.method !== "POST") {
            outgoing.writeHead(405).end();
            return;
          }
          if (url.pathname === "/__test/reset") await reset();
          else if (url.pathname === "/__test/inbox") {
            w.exec(
              "INSERT INTO notifications(id,user_id,post_id,type,channel,status,title,deep_link) VALUES ('inbox-one','owner','fixture-post','review_ready','in_app','sent','Review your campaign','/posts/fixture-post'),('inbox-two','owner',NULL,'test','in_app','sent','Workspace update',NULL)",
            );
          } else if (url.pathname === "/__test/large-inbox") {
            for (let i = 0; i < 105; i++)
              w.exec(
                "INSERT INTO notifications(id,user_id,type,channel,status,title,created_at) VALUES(?,'owner','test','in_app','sent',?,'2026-01-01 12:00:00')",
                `inbox-${String(i).padStart(3, "0")}`,
                `History message ${i}`,
              );
          } else if (url.pathname === "/__test/unknown-outcome") {
            w.exec(
              "UPDATE posts SET status='failed',failure_code='PUBLISH_OUTCOME_UNKNOWN',failure_message='Provider response was lost.',approved_at=CURRENT_TIMESTAMP WHERE id='fixture-post'",
            );
          } else if (url.pathname === "/__test/old-generation") {
            w.exec(
              "UPDATE generation_jobs SET created_at='2000-01-01' WHERE id='fixture-generation'",
            );
            for (let i = 0; i < 51; i++)
              w.exec(
                "INSERT INTO generation_jobs(id,client_id,asset_ids) VALUES(?,'client-a','[]')",
                `new-${i}`,
              );
          } else if (url.pathname === "/__test/large-paused") {
            for (let i = 0; i < 105; i++) {
              const id = `recovery-${String(i).padStart(3, "0")}`;
              w.post(id, "client-a", "paused");
              w.exec(
                "UPDATE posts SET title=?,graphic_key='fixture.jpg',created_at=? WHERE id=?",
                i === 0 ? "Oldest paused recovery" : `Paused recovery ${i}`,
                i === 0 ? "2000-01-01" : "2026-01-01",
                id,
              );
            }
          } else if (url.pathname === "/__test/complete-generation") {
            w.exec(
              "UPDATE generation_jobs SET status='completed',error_message=NULL WHERE id='fixture-generation'",
            );
          } else if (url.pathname === "/__test/drain-analytics") {
            for (
              let count = 0;
              count < 10 && w.generated.some((message) => message.kind === "analytics");
              count++
            ) {
              const index = w.generated.findIndex((message) => message.kind === "analytics"),
                body = w.generated.splice(index, 1)[0];
              await worker.queue(
                {
                  messages: [
                    {
                      body,
                      attempts: 1,
                      ack() {},
                      retry() {
                        throw Error("Unexpected analytics retry");
                      },
                    },
                  ],
                  queue: "brandsparq-generation",
                },
                w.env,
              );
            }
          } else if (url.pathname === "/__test/published") {
            w.exec(
              "UPDATE posts SET status='published',published_at=CURRENT_TIMESTAMP,approved_at=CURRENT_TIMESTAMP,platform_post_id='live' WHERE id='fixture-post'",
            );
          } else if (url.pathname === "/__test/expire") w.exec("UPDATE sessions SET expires_at=0");
          else if (url.pathname === "/__test/drain") {
            const messages = w.published.splice(0).map((body) => ({
              body,
              attempts: 1,
              ack() {},
              retry() {
                throw new Error("Unexpected publish retry");
              },
            }));
            await worker.queue({ messages, queue: "brandsparq-publish" }, w.env);
            await syncAccountAnalytics(w.env, "fixture-social");
          } else if (url.pathname !== "/__test/state") {
            outgoing.writeHead(404).end();
            return;
          }
          outgoing.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              post: w.row("SELECT * FROM posts WHERE id='fixture-post'"),
              notifications: w.sqlite.prepare("SELECT * FROM notifications").all(),
              generationJobs: w.sqlite.prepare("SELECT * FROM generation_jobs").all(),
            }),
          );
          return;
        }
        if (url.pathname === "/health" || url.pathname.startsWith("/v1/")) {
          const chunks = [];
          for await (const chunk of incoming) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          const request = new Request(url, {
            method: incoming.method,
            headers: incoming.headers,
            ...(body.length ? { body } : {}),
          });
          const response = await worker.fetch(request, w.env);
          outgoing.writeHead(response.status, Object.fromEntries(response.headers));
          outgoing.end(Buffer.from(await response.arrayBuffer()));
          return;
        }
      });
      return;
    }
    const asset = staticAsset(url.pathname, incoming.headers["if-none-match"]);
    outgoing
      .writeHead(asset.status, asset.headers || { "content-type": "text/plain" })
      .end(asset.body);
  } catch (error) {
    console.error(error);
    if (outgoing.headersSent) {
      outgoing.destroy();
      return;
    }
    outgoing
      .writeHead(500, { "content-type": "application/json" })
      .end(JSON.stringify({ error: error.message }));
  }
});
server.listen(port, "127.0.0.1", () => console.log(`BrandSparQ isolated test workspace: ${base}`));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      closeWorkspace?.();
      process.exit(0);
    }),
  );

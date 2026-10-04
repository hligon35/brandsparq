import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import worker from "../../cloudflare/src/index.ts";
import { encryptSecret } from "../../cloudflare/src/security.ts";
import { workspace, digest } from "../workspace.mjs";
import { syncAccountAnalytics } from "../../cloudflare/src/social.ts";

const port = Number(process.env.BRANDSPARQ_TEST_PORT || 8788);
const base = `http://127.0.0.1:${port}`;
const dist = path.resolve("dist");
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
  w.env.GOOGLE_REDIRECT_URI = `${base}/v1/auth/google/callback`;
  w.env.ENVIRONMENT = "development";
  w.post("fixture-post");
  w.exec(
    "UPDATE posts SET title='Launch campaign',headline='Launch campaign',graphic_key='fixture.jpg',suggested_publish_at=? WHERE id='fixture-post'",
    new Date(Date.now() + 3600000).toISOString(),
  );
  w.objects.set(
    "fixture.jpg",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh18AAAAASUVORK5CYII=",
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

const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".json": "application/json",
};
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, base);
    if (url.pathname.startsWith("/__test/")) {
      if (incoming.method !== "POST") {
        outgoing.writeHead(405).end();
        return;
      }
      if (url.pathname === "/__test/reset") await reset();
      else if (url.pathname === "/__test/expire") w.exec("UPDATE sessions SET expires_at=0");
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
    let file = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${dist}${path.sep}`)) file = path.join(dist, "index.html");
    if (!existsSync(file) || !path.extname(file)) file = path.join(dist, "index.html");
    outgoing
      .writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" })
      .end(readFileSync(file));
  } catch (error) {
    console.error(error);
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

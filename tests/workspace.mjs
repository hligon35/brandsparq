import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import worker from "../cloudflare/src/index.ts";

export const digest = (value) => createHash("sha256").update(value).digest("hex");

// Every fixture still applies every migration to a fresh database. Read the
// immutable source SQL once per process rather than on every HTTP reset.
const migrations = new URL("../cloudflare/migrations/", import.meta.url);
const migrationSql = readdirSync(migrations)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(new URL(name, migrations), "utf8"));

export function workspace(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const sql of migrationSql) sqlite.exec(sql);
  const prepare = (sql, values = []) => ({
    bind(...args) {
      return prepare(sql, args);
    },
    async first(column) {
      const row = sqlite.prepare(sql).get(...values);
      return row ? (column ? row[column] : { ...row }) : null;
    },
    async all() {
      return {
        success: true,
        results: sqlite
          .prepare(sql)
          .all(...values)
          .map((row) => ({ ...row })),
      };
    },
    execute() {
      const result = sqlite.prepare(sql).run(...values);
      return {
        success: true,
        meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
      };
    },
    async run() {
      return this.execute();
    },
  });
  const db = {
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const published = [],
    generated = [],
    objects = new Map();
  const env = {
    DB: db,
    ENVIRONMENT: "production",
    RELEASE_COMMIT: "a".repeat(40),
    AUTH_PEPPER: "test-pepper",
    AUTH_ALLOWED_EMAILS: "owner@example.test",
    GOOGLE_CLIENT_ID: "test-google-client",
    GOOGLE_CLIENT_SECRET: "test-google-secret",
    RESEND_API_KEY: "test-resend",
    RESEND_FROM_EMAIL: "test@example.test",
    REVIEW_NOTIFICATION_EMAIL: "owner@example.test",
    OPENAI_API_KEY: "test-openai",
    SOCIAL_TOKEN_KEY: "test-encryption-key",
    PUBLIC_BASE_URL: "https://brandsparq.getsparqd.com",
    GOOGLE_REDIRECT_URI: "https://brandsparq.getsparqd.com/v1/auth/google/callback",
    MEDIA: {
      async head(key) {
        return objects.has(key) ? {} : null;
      },
      async put(key, bytes) {
        objects.set(key, bytes);
      },
      async get(key) {
        return objects.has(key)
          ? {
              body: objects.get(key),
              async arrayBuffer() {
                const bytes = Buffer.from(objects.get(key));
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
              },
              httpMetadata: { contentType: "image/jpeg" },
              httpEtag: '"test"',
            }
          : null;
      },
    },
    PUBLISH_QUEUE: {
      async send(message) {
        published.push(message);
      },
    },
    GENERATION_QUEUE: {
      async send(message) {
        generated.push(message);
      },
    },
  };
  const exec = (sql, ...values) => sqlite.prepare(sql).run(...values);
  const row = (sql, ...values) => ({ ...sqlite.prepare(sql).get(...values) });
  sqlite.exec(`INSERT INTO users(id,email,role) VALUES ('owner','owner@example.test','owner'),('viewer','viewer@example.test','viewer');
    INSERT INTO clients(id,name,timezone) VALUES ('client-a','Client A','America/Indiana/Indianapolis'),('client-b','Client B','America/Indiana/Indianapolis');
    INSERT INTO user_client_access(user_id,client_id) VALUES ('viewer','client-a');`);
  for (const user of ["owner", "viewer"]) {
    exec(
      "INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)",
      user,
      user,
      digest(`${env.AUTH_PEPPER}:session:${user}-token`),
      Date.now() + 3600000,
      Date.now(),
      Date.now(),
    );
  }
  function post(id, client = "client-a", status = "awaiting_approval") {
    exec(
      "INSERT INTO posts(id,client_id,platform,status,title,caption,suggested_publish_at) VALUES (?,?,'facebook',?,'Test post','Test caption',?)",
      id,
      client,
      status,
      new Date(Date.now() + 86400000).toISOString(),
    );
    if (status === "published")
      exec("UPDATE posts SET published_at=CURRENT_TIMESTAMP WHERE id=?", id);
    if (
      [
        "calendar_scheduled",
        "pre_publish",
        "rescheduled",
        "publish_queued",
        "publishing",
        "published",
      ].includes(status)
    )
      exec("UPDATE posts SET approved_at=CURRENT_TIMESTAMP WHERE id=?", id);
  }
  async function request(path, { user, method = "GET", body, origin } = {}) {
    const headers = new Headers();
    if (user) headers.set("authorization", `Bearer ${user}-token`);
    if (origin) headers.set("origin", origin);
    if (body !== undefined) headers.set("content-type", "application/json");
    return worker.fetch(
      new Request(`${env.PUBLIC_BASE_URL}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
  }
  return { sqlite, env, exec, row, post, request, objects, published, generated };
}

// Existing workflow tests model a freshly loaded editor. Concurrency regressions
// pass explicit old revisions (or use raw worker requests to test missing revisions).
export function withCurrentRevision(w, path, body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const next = { ...body };
  const client = path.match(
    /^\/v1\/clients\/([^/]+)(?:\/brand|\/brand-assets(?:\/[^/]+\/remove)?)?$/,
  );
  const campaign = path.match(/^\/v1\/campaigns\/([^/]+)$/);
  const post = path.match(/^\/v1\/posts\/([^/]+)\/(edit|approve|social-account)$/);
  const review = path.match(/^\/v1\/public\/review\/([^/]+)\/(edit|approve)$/);
  let revision;
  if (client) revision = w.row("SELECT edit_revision n FROM clients WHERE id=?", client[1]).n;
  if (campaign)
    revision = w.row("SELECT workflow_revision n FROM campaigns WHERE id=?", campaign[1]).n;
  if (post) revision = w.row("SELECT content_revision n FROM posts WHERE id=?", post[1]).n;
  if (review)
    revision = w.row(
      "SELECT p.content_revision n FROM posts p JOIN review_tokens r ON r.post_id=p.id WHERE r.token_hash=?",
      digest(`${w.env.AUTH_PEPPER}:review:${review[1]}`),
    ).n;
  if (revision !== undefined && next.expectedRevision === undefined)
    next.expectedRevision = revision;
  const bulk = path === "/v1/posts/bulk/approve";
  const campaignBulk = path.match(/^\/v1\/campaigns\/([^/]+)\/posts\/approve$/);
  if ((bulk || campaignBulk) && next.expectedRevisions === undefined) {
    const rows = campaignBulk
      ? w.sqlite
          .prepare("SELECT id,content_revision FROM posts WHERE campaign_id=?")
          .all(campaignBulk[1])
      : (Array.isArray(next.postIds) ? next.postIds : [])
          .filter((id) => typeof id === "string")
          .map((id) => ({
            id,
            content_revision: w.row("SELECT content_revision FROM posts WHERE id=?", id)
              .content_revision,
          }));
    next.expectedRevisions = Object.fromEntries(rows.map((p) => [p.id, p.content_revision]));
  }
  return next;
}

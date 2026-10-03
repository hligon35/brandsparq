import { hashSecret } from "./security";

export interface MediaEnv {
  DB: D1Database;
  AUTH_PEPPER?: string;
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export async function issuePostMediaUrl(
  env: MediaEnv,
  requestUrl: string,
  userId: string,
  postId: string,
  r2Key?: string | null
) {
  if (!r2Key) return null;

  const token = randomToken();
  const expiresAt = Date.now() + 10 * 60 * 1000;

  await env.DB.prepare(
    `INSERT INTO media_access_tokens
     (id, post_id, user_id, token_hash, r2_key, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    postId,
    userId,
    await hashSecret(token, env.AUTH_PEPPER || ""),
    r2Key,
    expiresAt,
    Date.now()
  ).run();

  const origin = new URL(requestUrl).origin;
  return `${origin}/v1/public/media/${encodeURIComponent(token)}`;
}

export async function resolveMediaToken(
  env: MediaEnv,
  token: string
) {
  const tokenHash = await hashSecret(token, env.AUTH_PEPPER || "");
  return env.DB.prepare(
    `SELECT r2_key, expires_at
     FROM media_access_tokens
     WHERE token_hash = ?`
  ).bind(tokenHash).first<{ r2_key: string; expires_at: number }>();
}

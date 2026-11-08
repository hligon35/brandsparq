import { hashSecret } from "./security";

export async function revokePushDevice(
  env: { DB: D1Database; AUTH_PEPPER?: string },
  payload: { token?: unknown; cleanupToken?: unknown },
) {
  if (typeof payload.token !== "string" || !/^[a-f0-9]{64}$/.test(String(payload.cleanupToken)))
    return false;
  const hash = await hashSecret(String(payload.cleanupToken), env.AUTH_PEPPER || "");
  // A capability only disables its own registration. Rotation fences delayed cleanup.
  await env.DB.prepare(`UPDATE device_push_tokens SET enabled=0,cleanup_token_hash=NULL,
    updated_at=CURRENT_TIMESTAMP WHERE expo_push_token=? AND cleanup_token_hash=?`)
    .bind(payload.token, hash)
    .run();
  return true;
}

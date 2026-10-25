import type { SessionUser } from "./auth";
import { sendWorkspaceEmail, type NotificationEnv } from "./notifications";
type Env = NotificationEnv & { AUTH_PEPPER?: string; PUBLIC_BASE_URL?: string };
async function hash(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export async function handleProfile(request: Request, url: URL, env: Env, user: SessionUser) {
  if (!url.pathname.startsWith("/v1/profile")) return null;
  const profile = () =>
    env.DB.prepare("SELECT id,name,email,avatar_url,role FROM users WHERE id=?")
      .bind(user.id)
      .first();
  if (url.pathname === "/v1/profile" && request.method === "GET")
    return { body: { data: await profile() } };
  const body = await request
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  if (url.pathname === "/v1/profile" && request.method === "PATCH") {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120)
      return { status: 400, body: { error: "Enter a name between 1 and 120 characters." } };
    const avatar = body.avatar;
    if (
      avatar !== undefined &&
      avatar !== null &&
      (typeof avatar !== "string" ||
        avatar.length > 700000 ||
        !/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(avatar))
    )
      return { status: 400, body: { error: "Choose a PNG or JPEG avatar under 500 KB." } };
    if (typeof avatar === "string") {
      let binary = "";
      try {
        binary = atob(avatar.split(",")[1]);
      } catch {
        return { status: 400, body: { error: "The avatar image could not be read." } };
      }
      if (!binary.startsWith("\x89PNG") && !binary.startsWith("\xff\xd8\xff"))
        return { status: 415, body: { error: "Choose a valid PNG or JPEG image." } };
    }
    await env.DB.prepare(
      "UPDATE users SET name=?,avatar_url=CASE WHEN ? THEN ? ELSE avatar_url END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(body.name.trim(), avatar !== undefined ? 1 : 0, avatar ?? null, user.id)
      .run();
    return { body: { data: await profile() } };
  }
  if (url.pathname === "/v1/profile/email/request" && request.method === "POST") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      return { status: 400, body: { error: "Enter a valid email address." } };
    if (await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first())
      return { status: 409, body: { error: "That email address is already in use." } };
    const prior = await env.DB.prepare(
      "SELECT requested_at FROM profile_email_changes WHERE user_id=?",
    )
      .bind(user.id)
      .first<{ requested_at: number }>();
    if (prior && Date.now() - prior.requested_at < 60000)
      return { status: 429, body: { error: "Wait one minute before requesting another code." } };
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
    const codeHash = await hash(`${env.AUTH_PEPPER}:${user.id}:${email}:${code}`);
    const issued = await env.DB.prepare(
      "INSERT INTO profile_email_changes(user_id,email,code_hash,expires_at,requested_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,requested_at=excluded.requested_at WHERE profile_email_changes.requested_at < excluded.requested_at - 60000",
    )
      .bind(user.id, email, codeHash, Date.now() + 15 * 60000, Date.now())
      .run();
    if (!issued.meta.changes)
      return { status: 429, body: { error: "Wait one minute before requesting another code." } };
    const sent = await sendWorkspaceEmail(
      env,
      email,
      "Verify your BrandSparQ email",
      `Your verification code is ${code}. It expires in 15 minutes.`,
      `${env.PUBLIC_BASE_URL || "https://brandsparq.getsparqd.com"}/profile`,
      `profile-email:${user.id}:${Date.now()}`,
    );
    if (!sent.ok)
      return {
        status: 503,
        body: { error: "We couldn't send the code. Please try again in a minute." },
      };
    return { body: { ok: true } };
  }
  if (url.pathname === "/v1/profile/email/verify" && request.method === "POST") {
    const pending = await env.DB.prepare("SELECT * FROM profile_email_changes WHERE user_id=?")
      .bind(user.id)
      .first<{ email: string; code_hash: string; expires_at: number; attempts: number }>();
    if (!pending || pending.expires_at < Date.now() || pending.attempts >= 5)
      return { status: 400, body: { error: "This code expired. Request a new code." } };
    await env.DB.prepare("UPDATE profile_email_changes SET attempts=attempts+1 WHERE user_id=?")
      .bind(user.id)
      .run();
    if (
      typeof body.code !== "string" ||
      !/^\d{6}$/.test(body.code) ||
      (await hash(`${env.AUTH_PEPPER}:${user.id}:${pending.email}:${body.code}`)) !==
        pending.code_hash
    )
      return { status: 400, body: { error: "That code wasn't accepted. Try again." } };
    if (
      await env.DB.prepare("SELECT id FROM users WHERE email=? AND id<>?")
        .bind(pending.email, user.id)
        .first()
    )
      return { status: 409, body: { error: "That email address is already in use." } };
    const results = await env.DB.batch([
      env.DB.prepare(
        "UPDATE users SET email=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND EXISTS(SELECT 1 FROM profile_email_changes WHERE user_id=? AND code_hash=? AND expires_at>? AND attempts<=5)",
      ).bind(pending.email, user.id, user.id, pending.code_hash, Date.now()),
      env.DB.prepare(
        "UPDATE review_tokens SET revoked_at=? WHERE recipient_email=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND email=?)",
      ).bind(Date.now(), user.email, user.id, pending.email),
      env.DB.prepare(
        "UPDATE client_reviewers SET enabled=0 WHERE email=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND email=?)",
      ).bind(user.email, user.id, pending.email),
      env.DB.prepare("DELETE FROM profile_email_changes WHERE user_id=? AND code_hash=?").bind(
        user.id,
        pending.code_hash,
      ),
    ]);
    if (!results[0].meta.changes)
      return { status: 400, body: { error: "That code was already used. Request a new code." } };
    return { body: { data: await profile() } };
  }
  if (url.pathname === "/v1/profile" && request.method === "DELETE") {
    if (body.confirmation !== "DELETE")
      return { status: 400, body: { error: "Type DELETE to confirm account deletion." } };
    if (
      user.role === "owner" &&
      !(await env.DB.prepare(
        "SELECT id FROM users WHERE role='owner' AND status='active' AND id<>?",
      )
        .bind(user.id)
        .first())
    )
      return {
        status: 409,
        body: { error: "Add another active owner before deleting your account." },
      };
    const removed = await env.DB.batch([
      env.DB.prepare(
        "UPDATE users SET status='removed',name='Deleted account',email=?,avatar_url=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (role<>'owner' OR EXISTS (SELECT 1 FROM users other WHERE other.role='owner' AND other.status='active' AND other.id<>users.id))",
      ).bind(`deleted-${user.id}@deleted.invalid`, user.id),
      env.DB.prepare(
        "UPDATE sessions SET revoked_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=sessions.user_id AND status='removed')",
      ).bind(Date.now(), user.id),
      env.DB.prepare(
        "DELETE FROM user_client_access WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=user_client_access.user_id AND status='removed')",
      ).bind(user.id),
      env.DB.prepare(
        "UPDATE device_push_tokens SET enabled=0 WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=device_push_tokens.user_id AND status='removed')",
      ).bind(user.id),
      env.DB.prepare(
        "UPDATE review_tokens SET revoked_at=? WHERE recipient_email=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='removed')",
      ).bind(Date.now(), user.email, user.id),
      env.DB.prepare(
        "UPDATE client_reviewers SET enabled=0 WHERE email=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='removed')",
      ).bind(user.email, user.id),
      env.DB.prepare(
        "UPDATE social_oauth_states SET consumed_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='removed')",
      ).bind(Date.now(), user.id, user.id),
      env.DB.prepare(
        "DELETE FROM google_auth_handoffs WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='removed')",
      ).bind(user.id, user.id),
      env.DB.prepare("DELETE FROM profile_email_changes WHERE user_id=?").bind(user.id),
    ]);
    if (!removed[0].meta.changes)
      return {
        status: 409,
        body: { error: "Add another active owner before deleting your account." },
      };
    return { body: { ok: true } };
  }
  return null;
}

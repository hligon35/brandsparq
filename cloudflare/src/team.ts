import type { SessionUser } from "./auth";
import { hashSecret } from "./security";
import { sendWorkspaceEmail, type NotificationEnv } from "./notifications";
export type TeamEnv = NotificationEnv & { AUTH_PEPPER?: string; PUBLIC_BASE_URL?: string };
const roles = ["admin", "reviewer", "publisher", "viewer"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function invitationPreview(env: TeamEnv, token: string) {
  const row = await env.DB.prepare(
    "SELECT email,expires_at,status FROM team_invitations WHERE token_hash=?",
  )
    .bind(await hashSecret("invitation:" + token, env.AUTH_PEPPER || ""))
    .first<any>();
  if (!row || row.status !== "pending" || row.expires_at <= Date.now())
    return { body: { error: "Invitation is expired, revoked or already accepted." }, status: 404 };
  return { body: { data: { email: row.email, expiresAt: row.expires_at } } };
}
async function invite(env: TeamEnv, actor: SessionUser, payload: any) {
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const role = payload.role;
  const assignments = payload.clientRoles;
  if (
    !emailPattern.test(email) ||
    email.length > 254 ||
    !roles.includes(role) ||
    !assignments ||
    typeof assignments !== "object" ||
    Array.isArray(assignments) ||
    Object.keys(assignments).length > 50
  )
    return {
      body: { error: "A valid email, workspace role and client roles are required." },
      status: 400,
    };
  for (const [clientId, accessRole] of Object.entries(assignments)) {
    if (
      !roles.includes(String(accessRole)) ||
      !(await env.DB.prepare("SELECT id FROM clients WHERE id=? AND status='active'")
        .bind(clientId)
        .first())
    )
      return { body: { error: "Choose active clients and valid client roles." }, status: 400 };
  }
  const existing = await env.DB.prepare("SELECT id,status FROM users WHERE email=?")
    .bind(email)
    .first<any>();
  if (existing && existing.status !== "invited")
    return {
      body: {
        error:
          "This person already has an account. Manage their status and client assignments instead.",
      },
      status: 409,
    };
  if (!env.PUBLIC_BASE_URL)
    return { body: { error: "The public application URL is not configured." }, status: 503 };
  const id = crypto.randomUUID();
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  const expiresAt = Date.now() + 7 * 86400000;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users(id,email,role,status) VALUES (?,?,?,'invited') ON CONFLICT(email) DO NOTHING",
    ).bind(existing?.id || crypto.randomUUID(), email, role),
    env.DB.prepare(
      "UPDATE team_invitations SET status='revoked' WHERE email=? AND status='pending'",
    ).bind(email),
    env.DB.prepare(
      "INSERT INTO team_invitations(id,email,role,client_roles_json,token_hash,expires_at,invited_by) VALUES (?,?,?,?,?,?,?)",
    ).bind(
      id,
      email,
      role,
      JSON.stringify(assignments),
      await hashSecret("invitation:" + token, env.AUTH_PEPPER || ""),
      expiresAt,
      actor.id,
    ),
  ]);
  const result = await sendWorkspaceEmail(
    env,
    email,
    "You are invited to BrandSparQ",
    "Sign in with this Google account to accept your invitation. This invitation expires in seven days.",
    `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/invite/${token}`,
    `invite:${id}`,
  );
  await env.DB.prepare("UPDATE team_invitations SET delivery_status=?,delivery_error=? WHERE id=?")
    .bind(result.ok ? "sent" : "failed", result.error || null, id)
    .run();
  return {
    body: {
      ok: true,
      id,
      deliveryStatus: result.ok ? "sent" : "failed",
      error: result.error || null,
    },
    status: 201,
  };
}
export async function handleTeamRoute(
  request: Request,
  url: URL,
  env: TeamEnv,
  user: SessionUser,
): Promise<{ body: unknown; status?: number } | null> {
  if (!url.pathname.startsWith("/v1/team")) return null;
  if (user.role !== "owner") return { body: { error: "Owner access is required." }, status: 403 };
  if (request.method === "GET" && url.pathname === "/v1/team/invitations") {
    const rows = await env.DB.prepare(
      "SELECT id,email,role,client_roles_json,status,expires_at,delivery_status,delivery_error,created_at FROM team_invitations ORDER BY created_at DESC LIMIT 100",
    ).all<any>();
    return {
      body: {
        data: rows.results.map((r) => ({
          ...r,
          status: r.status === "pending" && r.expires_at <= Date.now() ? "expired" : r.status,
          clientRoles: JSON.parse(r.client_roles_json),
        })),
      },
    };
  }
  if (request.method === "POST" && url.pathname === "/v1/team/invitations")
    return invite(env, user, await request.json().catch(() => ({})));
  const action = url.pathname.match(/^\/v1\/team\/invitations\/([^/]+)\/(revoke|resend)$/);
  if (request.method === "POST" && action) {
    const row = await env.DB.prepare("SELECT * FROM team_invitations WHERE id=?")
      .bind(action[1])
      .first<any>();
    if (!row) return { body: { error: "Invitation not found." }, status: 404 };
    if (row.status === "accepted")
      return { body: { error: "This invitation was already accepted." }, status: 409 };
    if (action[2] === "resend")
      return invite(env, user, {
        email: row.email,
        role: row.role,
        clientRoles: JSON.parse(row.client_roles_json),
      });
    await env.DB.prepare(
      "UPDATE team_invitations SET status='revoked' WHERE id=? AND status='pending'",
    )
      .bind(row.id)
      .run();
    return { body: { ok: true } };
  }
  const member = url.pathname.match(/^\/v1\/team\/users\/([^/]+)\/(status|revoke-sessions)$/);
  if (request.method === "POST" && member) {
    const target = await env.DB.prepare("SELECT id,role,status FROM users WHERE id=?")
      .bind(member[1])
      .first<any>();
    if (!target) return { body: { error: "Person not found." }, status: 404 };
    if (target.id === user.id)
      return {
        body: {
          error:
            "Use Sign out for your own session. Another owner must manage your account status.",
        },
        status: 409,
      };
    const payload = await request.json<any>().catch(() => ({}));
    const status = member[2] === "status" ? payload.status : target.status;
    if (!["active", "suspended", "removed"].includes(status) || target.status === "invited")
      return {
        body: {
          error:
            "Use invitation controls for pending people; otherwise choose active, suspended or removed.",
        },
        status: 400,
      };
    // The conditional write preserves at least one active owner even under concurrent requests.
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE users SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND
     (role!='owner' OR ?='active' OR (SELECT COUNT(*) FROM users WHERE role='owner' AND status='active')>1)`).bind(
        status,
        target.id,
        status,
      ),
      env.DB.prepare(
        "UPDATE sessions SET revoked_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status=?)",
      ).bind(Date.now(), target.id, target.id, status),
      env.DB.prepare(
        "UPDATE device_push_tokens SET enabled=0 WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND status=?)",
      ).bind(target.id, target.id, status),
      env.DB.prepare(
        "UPDATE review_tokens SET revoked_at=? WHERE recipient_email=(SELECT email FROM users WHERE id=? AND status!='active')",
      ).bind(Date.now(), target.id),
      env.DB.prepare(
        "UPDATE client_reviewers SET enabled=0 WHERE email=(SELECT email FROM users WHERE id=? AND status!='active')",
      ).bind(target.id),
      env.DB.prepare("UPDATE social_oauth_states SET consumed_at=? WHERE user_id=?").bind(
        Date.now(),
        target.id,
      ),
      env.DB.prepare("DELETE FROM google_auth_handoffs WHERE user_id=?").bind(target.id),
      env.DB.prepare(
        "INSERT INTO recovery_actions(id,actor_user_id,action,entity_type,entity_id,previous_state,next_state) SELECT ?,?,'manage_team_member','user',?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND status=?)",
      ).bind(crypto.randomUUID(), user.id, target.id, target.status, status, target.id, status),
    ]);
    if (!results[0].meta.changes)
      return { body: { error: "BrandSparQ must retain an active owner." }, status: 409 };
    return { body: { ok: true } };
  }
  return null;
}

export type AuthEnv = {
  DB: D1Database;
  ENVIRONMENT?: string;
  AUTH_PEPPER?: string;
  AUTH_ALLOWED_EMAILS?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_FROM_NAME?: string;
};

export type SessionUser = {
  id: string;
  email: string;
  name?: string;
  role: string;
};

export type RouteResult = {
  body: unknown;
  status?: number;
};

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return bytesToHex(new Uint8Array(digest));
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

function randomCode() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return String(value[0] % 1_000_000).padStart(6, "0");
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function emailAllowed(email: string, env: AuthEnv) {
  const list = (env.AUTH_ALLOWED_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return !list.length || list.includes(email);
}

async function codeHash(email: string, code: string, env: AuthEnv) {
  return sha256(`${env.AUTH_PEPPER || ""}:code:${email}:${code}`);
}

async function sessionHash(token: string, env: AuthEnv) {
  return sha256(`${env.AUTH_PEPPER || ""}:session:${token}`);
}

async function sendCode(email: string, code: string, env: AuthEnv) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return false;

  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `${env.RESEND_FROM_NAME || "BrandSparQ"} <${env.RESEND_FROM_EMAIL}>`,
      to: [email],
      subject: "Your BrandSparQ sign-in code",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px">
          <p style="letter-spacing:.12em;font-weight:700">BRANDSPARQ</p>
          <h1 style="font-size:28px">Your sign-in code</h1>
          <p>Enter this code to sign in. It expires in 10 minutes.</p>
          <div style="font-size:34px;font-weight:800;letter-spacing:.2em;margin:28px 0">${code}</div>
          <p style="color:#68707f">If you did not request this code, you can ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!result.ok) {
    const detail = await result.text();
    throw new Error(`Resend sign-in email failed: ${result.status} ${detail.slice(0, 300)}`);
  }
  return true;
}

export async function getSessionUser(
  request: Request,
  env: AuthEnv
): Promise<SessionUser | null> {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const hash = await sessionHash(match[1], env);
  const now = Date.now();

  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, s.id AS session_id
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?`
  )
    .bind(hash, now)
    .first<SessionUser & { session_id: string }>();

  if (!row) return null;

  await env.DB.prepare(
    "UPDATE sessions SET last_seen_at = ? WHERE id = ?"
  )
    .bind(now, row.session_id)
    .run();

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

export async function handleAuthRoute(
  request: Request,
  url: URL,
  env: AuthEnv
): Promise<RouteResult | null> {
  if (request.method === "POST" && url.pathname === "/v1/auth/request-code") {
    const payload = await request.json<{ email?: string }>().catch(() => ({}));
    const email = normalizeEmail(payload.email);

    if (!email || !email.includes("@")) {
      return { body: { error: "A valid email address is required." }, status: 400 };
    }
    if (!emailAllowed(email, env)) {
      return { body: { error: "This email is not authorized for BrandSparQ." }, status: 403 };
    }
    if (!env.AUTH_PEPPER && env.ENVIRONMENT === "production") {
      return { body: { error: "Authentication is not configured." }, status: 503 };
    }

    const code = randomCode();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO auth_codes
       (id, email, code_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        email,
        await codeHash(email, code, env),
        now + CODE_TTL_MS,
        now
      )
      .run();

    const delivered = await sendCode(email, code, env);
    const development = env.ENVIRONMENT !== "production";

    return {
      body: {
        ok: true,
        ...(development && !delivered ? { devCode: code } : {}),
      },
    };
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/verify-code") {
    const payload = await request
      .json<{ email?: string; code?: string }>()
      .catch(() => ({}));
    const email = normalizeEmail(payload.email);
    const code = typeof payload.code === "string" ? payload.code.trim() : "";

    if (!email || !/^\d{6}$/.test(code)) {
      return { body: { error: "Email and a valid six-digit code are required." }, status: 400 };
    }

    const hash = await codeHash(email, code, env);
    const now = Date.now();
    const codeRow = await env.DB.prepare(
      `SELECT id FROM auth_codes
       WHERE email = ?
         AND code_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
      .bind(email, hash, now)
      .first<{ id: string }>();

    if (!codeRow) {
      return { body: { error: "That code is invalid or has expired." }, status: 401 };
    }

    let user = await env.DB.prepare(
      "SELECT id, email, name, role FROM users WHERE email = ?"
    )
      .bind(email)
      .first<SessionUser>();

    if (!user) {
      const userId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO users (id, email, role)
         VALUES (?, ?, 'owner')`
      )
        .bind(userId, email)
        .run();
      user = { id: userId, email, role: "owner" };
    }

    const token = randomToken();
    const expiresAt = now + SESSION_TTL_MS;

    await env.DB.batch([
      env.DB.prepare(
        "UPDATE auth_codes SET consumed_at = ? WHERE id = ?"
      ).bind(now, codeRow.id),
      env.DB.prepare(
        `INSERT INTO sessions
         (id, user_id, token_hash, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        user.id,
        await sessionHash(token, env),
        expiresAt,
        now,
        now
      ),
    ]);

    return { body: { token, expiresAt, user } };
  }

  if (request.method === "GET" && url.pathname === "/v1/auth/session") {
    const user = await getSessionUser(request, env);
    if (!user) return { body: { error: "Authentication required." }, status: 401 };
    return { body: { user } };
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
    const authorization = request.headers.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) {
      const hash = await sessionHash(match[1], env);
      await env.DB.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE token_hash = ?"
      )
        .bind(Date.now(), hash)
        .run();
    }
    return { body: { ok: true } };
  }

  return null;
}

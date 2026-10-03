export type AuthEnv = {
  DB: D1Database;
  ENVIRONMENT?: string;
  AUTH_PEPPER?: string;
  AUTH_ALLOWED_EMAILS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
};

export type SessionUser = {
  id: string;
  email: string;
  name?: string;
  role: string;
};

export type RouteResult =
  | {
      body: unknown;
      status?: number;
      response?: never;
    }
  | {
      response: Response;
      body?: never;
      status?: never;
    };

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 5 * 60 * 1000;

function bytesToHex(bytes: Uint8Array) {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
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

async function sessionHash(token: string, env: AuthEnv) {
  return sha256(`${env.AUTH_PEPPER || ""}:session:${token}`);
}

async function stateHash(token: string, env: AuthEnv) {
  return sha256(`${env.AUTH_PEPPER || ""}:google-state:${token}`);
}

async function handoffHash(token: string, env: AuthEnv) {
  return sha256(`${env.AUTH_PEPPER || ""}:google-handoff:${token}`);
}

function googleClientId(env: AuthEnv) {
  return env.GOOGLE_CLIENT_ID || env.GOOGLE_OAUTH_CLIENT_ID || "";
}

function googleClientSecret(env: AuthEnv) {
  return env.GOOGLE_CLIENT_SECRET || env.GOOGLE_OAUTH_CLIENT_SECRET || "";
}

function missingGoogleConfig(env: AuthEnv) {
  const missing: string[] = [];
  if (!googleClientId(env)) {
    missing.push("GOOGLE_CLIENT_ID (or GOOGLE_OAUTH_CLIENT_ID)");
  }
  if (!googleClientSecret(env)) {
    missing.push("GOOGLE_CLIENT_SECRET (or GOOGLE_OAUTH_CLIENT_SECRET)");
  }
  return missing;
}

function googleConfigured(env: AuthEnv) {
  return missingGoogleConfig(env).length === 0;
}

function redirectUri(url: URL, env: AuthEnv) {
  return (
    env.GOOGLE_REDIRECT_URI ||
    `${url.origin}/v1/auth/google/callback`
  );
}

function validReturnTo(returnTo: string, requestOrigin: string, env: AuthEnv) {
  try {
    const target = new URL(returnTo);

    if (target.protocol === "brandsparq:") return true;

    if (
      (target.protocol === "https:" || target.protocol === "http:") &&
      target.origin === requestOrigin
    ) {
      return true;
    }

    if (
      env.ENVIRONMENT !== "production" &&
      target.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(target.hostname)
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function withQuery(returnTo: string, key: string, value: string) {
  const target = new URL(returnTo);
  target.searchParams.set(key, value);
  return target.toString();
}

async function createSession(
  env: AuthEnv,
  user: SessionUser
): Promise<{ token: string; expiresAt: number }> {
  const now = Date.now();
  const token = randomToken();
  const expiresAt = now + SESSION_TTL_MS;

  await env.DB.prepare(
    `INSERT INTO sessions
     (id, user_id, token_hash, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      user.id,
      await sessionHash(token, env),
      expiresAt,
      now,
      now
    )
    .run();

  return { token, expiresAt };
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
  if (
    request.method === "GET" &&
    url.pathname === "/v1/auth/google/start"
  ) {
    if (!googleConfigured(env)) {
      return {
        body: {
          error: "Google authentication is not configured.",
          missing: missingGoogleConfig(env),
        },
        status: 503,
      };
    }

    const returnTo =
      url.searchParams.get("return_to") || `${url.origin}/login`;

    if (!validReturnTo(returnTo, url.origin, env)) {
      return {
        body: { error: "Invalid authentication return URL." },
        status: 400,
      };
    }

    const state = randomToken();
    const now = Date.now();

    await env.DB.prepare(
      `INSERT INTO google_oauth_states
       (id, state_hash, return_to, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        await stateHash(state, env),
        returnTo,
        now + OAUTH_STATE_TTL_MS,
        now
      )
      .run();

    const google = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    google.searchParams.set("client_id", googleClientId(env));
    google.searchParams.set("redirect_uri", redirectUri(url, env));
    google.searchParams.set("response_type", "code");
    google.searchParams.set("scope", "openid email profile");
    google.searchParams.set("state", state);
    google.searchParams.set("prompt", "select_account");
    google.searchParams.set("access_type", "online");

    return { response: Response.redirect(google.toString(), 302) };
  }

  if (
    request.method === "GET" &&
    url.pathname === "/v1/auth/google/callback"
  ) {
    if (!googleConfigured(env)) {
      return {
        body: { error: "Google authentication is not configured." },
        status: 503,
      };
    }

    const state = url.searchParams.get("state") || "";
    const stateRow = state
      ? await env.DB.prepare(
          `SELECT id, return_to, expires_at, consumed_at
           FROM google_oauth_states
           WHERE state_hash = ?`
        )
          .bind(await stateHash(state, env))
          .first<{
            id: string;
            return_to: string;
            expires_at: number;
            consumed_at: number | null;
          }>()
      : null;

    if (
      !stateRow ||
      stateRow.consumed_at ||
      stateRow.expires_at <= Date.now()
    ) {
      return {
        body: { error: "Google sign-in state is invalid or expired." },
        status: 400,
      };
    }

    await env.DB.prepare(
      "UPDATE google_oauth_states SET consumed_at = ? WHERE id = ?"
    )
      .bind(Date.now(), stateRow.id)
      .run();

    const oauthError = url.searchParams.get("error");
    const code = url.searchParams.get("code");

    if (oauthError || !code) {
      return {
        response: Response.redirect(
          withQuery(
            stateRow.return_to,
            "auth_error",
            oauthError || "Google sign-in was canceled."
          ),
          302
        ),
      };
    }

    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: googleClientId(env),
          client_secret: googleClientSecret(env),
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri(url, env),
        }),
      }
    );

    if (!tokenResponse.ok) {
      return {
        response: Response.redirect(
          withQuery(
            stateRow.return_to,
            "auth_error",
            "Google could not complete sign-in."
          ),
          302
        ),
      };
    }

    const tokens = await tokenResponse.json<{
      id_token?: string;
    }>();

    if (!tokens.id_token) {
      return {
        response: Response.redirect(
          withQuery(
            stateRow.return_to,
            "auth_error",
            "Google did not return an identity token."
          ),
          302
        ),
      };
    }

    const verifyResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`
    );

    if (!verifyResponse.ok) {
      return {
        response: Response.redirect(
          withQuery(
            stateRow.return_to,
            "auth_error",
            "Google identity verification failed."
          ),
          302
        ),
      };
    }

    const profile = await verifyResponse.json<{
      aud?: string;
      iss?: string;
      sub?: string;
      email?: string;
      email_verified?: string | boolean;
      name?: string;
      picture?: string;
    }>();

    const email = normalizeEmail(profile.email);
    const verified =
      profile.email_verified === true ||
      profile.email_verified === "true";
    const issuerAllowed =
      profile.iss === "accounts.google.com" ||
      profile.iss === "https://accounts.google.com";

    if (
      profile.aud !== googleClientId(env) ||
      !issuerAllowed ||
      !verified ||
      !email
    ) {
      return {
        response: Response.redirect(
          withQuery(
            stateRow.return_to,
            "auth_error",
            "Google account verification failed."
          ),
          302
        ),
      };
    }

    if (!emailAllowed(email, env)) {
      return {
        response: Response.redirect(
          withQuery(
            stateRow.return_to,
            "auth_error",
            "This Google account is not authorized for BrandSparQ."
          ),
          302
        ),
      };
    }

    let user = await env.DB.prepare(
      "SELECT id, email, name, role FROM users WHERE email = ?"
    )
      .bind(email)
      .first<SessionUser>();

    if (!user) {
      const userId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO users
         (id, email, name, role, google_sub, avatar_url)
         VALUES (?, ?, ?, 'owner', ?, ?)`
      )
        .bind(
          userId,
          email,
          profile.name || null,
          profile.sub || null,
          profile.picture || null
        )
        .run();

      user = {
        id: userId,
        email,
        name: profile.name || undefined,
        role: "owner",
      };
    } else {
      await env.DB.prepare(
        `UPDATE users
         SET name = COALESCE(?, name),
             google_sub = COALESCE(?, google_sub),
             avatar_url = COALESCE(?, avatar_url),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
        .bind(
          profile.name || null,
          profile.sub || null,
          profile.picture || null,
          user.id
        )
        .run();
    }

    const handoff = randomToken();
    const now = Date.now();

    await env.DB.prepare(
      `INSERT INTO google_auth_handoffs
       (id, user_id, handoff_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        await handoffHash(handoff, env),
        now + HANDOFF_TTL_MS,
        now
      )
      .run();

    return {
      response: Response.redirect(
        withQuery(stateRow.return_to, "handoff", handoff),
        302
      ),
    };
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/auth/google/complete"
  ) {
    const payload = await request
      .json<{ handoff?: string }>()
      .catch(() => ({} as any));
    const handoff =
      typeof payload.handoff === "string" ? payload.handoff : "";

    if (!handoff) {
      return {
        body: { error: "Google sign-in handoff is required." },
        status: 400,
      };
    }

    const now = Date.now();
    const row = await env.DB.prepare(
      `SELECT h.id, h.user_id, h.expires_at, h.consumed_at,
              u.email, u.name, u.role
       FROM google_auth_handoffs h
       JOIN users u ON u.id = h.user_id
       WHERE h.handoff_hash = ?`
    )
      .bind(await handoffHash(handoff, env))
      .first<{
        id: string;
        user_id: string;
        expires_at: number;
        consumed_at: number | null;
        email: string;
        name?: string;
        role: string;
      }>();

    if (!row || row.consumed_at || row.expires_at <= now) {
      return {
        body: {
          error: "Google sign-in handoff is invalid or expired.",
        },
        status: 401,
      };
    }

    await env.DB.prepare(
      "UPDATE google_auth_handoffs SET consumed_at = ? WHERE id = ?"
    )
      .bind(now, row.id)
      .run();

    const user: SessionUser = {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
    };

    const session = await createSession(env, user);

    return {
      body: {
        token: session.token,
        expiresAt: session.expiresAt,
        user,
      },
    };
  }

  if (
    request.method === "GET" &&
    url.pathname === "/v1/auth/session"
  ) {
    const user = await getSessionUser(request, env);
    if (!user) {
      return {
        body: { error: "Authentication required." },
        status: 401,
      };
    }
    return { body: { user } };
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/auth/logout"
  ) {
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

import { renderFinalCopy, finalCopyError } from "../../src/shared/final-copy";
import { providerFetch } from "./provider-http";
import { socialProfileImage } from "./social-profile";
import { latestMetricsJoin } from "./analytics";
import { hasClientPermission } from "./authz";
import { decryptSecret, encryptSecret, hashSecret } from "./security";

export interface SocialEnv {
  DB: D1Database;
  ENVIRONMENT?: string;
  MEDIA: R2Bucket;
  SOCIAL_TOKEN_KEY?: string;
  AUTH_PEPPER?: string;
  PUBLIC_BASE_URL?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_LOGIN_CONFIG_ID?: string;
  META_REDIRECT_URI?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_REDIRECT_URI?: string;
  LINKEDIN_ORGANIZATION_SCOPES?: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  TIKTOK_REDIRECT_URI?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_REDIRECT_URI?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
}

type Platform = "facebook" | "instagram" | "linkedin" | "tiktok" | "x";

type SocialAccountRow = {
  id: string;
  client_id: string;
  platform: Platform;
  account_name?: string | null;
  external_account_id?: string | null;
  status: string;
  access_token_ciphertext?: string | null;
  refresh_token_ciphertext?: string | null;
  token_expires_at?: number | null;
  scopes?: string | null;
  metadata?: string | null;
  account_type?: string | null;
  health_status?: string | null;
  health_checked_at?: string | null;
  connection_revision: number;
  refresh_claim?: string | null;
  refresh_until?: number | null;
};

export class SocialConnectionChanged extends Error {
  constructor(message = "This connection changed. Refresh the list before trying again.") {
    super(message);
  }
}

export class SocialProviderError extends Error {
  status?: number;
  category: "rate_limit" | "authorization" | "temporary" | "permanent" | "uncertain";
  retryable: boolean;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    options: {
      status?: number;
      category?: "rate_limit" | "authorization" | "temporary" | "permanent" | "uncertain";
      retryable?: boolean;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "SocialProviderError";
    this.status = options.status;
    this.category = options.category || "permanent";
    this.retryable = options.retryable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function classifyProviderResponse(response: Response, detail: string) {
  const status = response.status;
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;

  if (status === 429) {
    return new SocialProviderError(detail, {
      status,
      category: "rate_limit",
      retryable: true,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 300,
    });
  }
  if (status === 401 || status === 403) {
    return new SocialProviderError(detail, {
      status,
      category: "authorization",
      retryable: false,
    });
  }
  if (status >= 500 || status === 408) {
    return new SocialProviderError(detail, {
      status,
      category: "temporary",
      retryable: true,
    });
  }
  return new SocialProviderError(detail, {
    status,
    category: "permanent",
    retryable: false,
  });
}

async function requireProviderOk(response: Response, label: string) {
  if (response.ok) return response;
  const detail = (await response.text()).slice(0, 1000);
  throw classifyProviderResponse(response, `${label}: ${detail}`);
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function configuredRedirect(platform: Platform, url: URL, env: SocialEnv) {
  if (platform === "facebook" || platform === "instagram") {
    return env.META_REDIRECT_URI || `${url.origin}/v1/social/meta/callback`;
  }
  if (platform === "linkedin") {
    return env.LINKEDIN_REDIRECT_URI || `${url.origin}/v1/social/linkedin/callback`;
  }
  if (platform === "tiktok") {
    return env.TIKTOK_REDIRECT_URI || `${url.origin}/v1/social/tiktok/callback`;
  }
  return env.X_REDIRECT_URI || `${url.origin}/v1/social/x/callback`;
}

function providerKey(platform: Platform) {
  return platform === "facebook" || platform === "instagram" ? "meta" : platform;
}

function providerConfigured(platform: Platform, env: SocialEnv) {
  if (platform === "facebook" || platform === "instagram") {
    return !!(env.META_APP_ID && env.META_APP_SECRET);
  }
  if (platform === "linkedin") {
    return !!(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
  }
  if (platform === "tiktok") {
    return !!(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);
  }
  return !!env.X_CLIENT_ID;
}

function validReturnTo(value: string, requestOrigin: string, env: SocialEnv) {
  try {
    const target = new URL(value);
    return (
      target.protocol === (env.ENVIRONMENT === "staging" ? "brandsparq-staging:" : "brandsparq:") ||
      target.origin === requestOrigin ||
      (env.ENVIRONMENT === "development" &&
        target.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(target.hostname))
    );
  } catch {
    return false;
  }
}

function redirectWithParams(returnTo: string, params: Record<string, string>) {
  const target = new URL(returnTo);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return target.toString();
}

export async function socialOAuthStart(
  env: SocialEnv,
  url: URL,
  platform: Platform,
  clientId: string,
  userId: string,
  returnTo: string,
  importClients = false,
) {
  if (!providerConfigured(platform, env)) {
    throw new Error(`${platform} OAuth is not configured.`);
  }
  if (!validReturnTo(returnTo, url.origin, env)) {
    throw new Error("Invalid social OAuth return URL.");
  }
  if (importClients) {
    const owner = await env.DB.prepare(
      "SELECT id FROM users WHERE id=? AND role='owner' AND status='active'",
    )
      .bind(userId)
      .first();
    if (!owner || !["facebook", "instagram"].includes(platform))
      throw new Error("Only a workspace owner can import clients from Meta.");
  }
  const metaConfigId = env.META_LOGIN_CONFIG_ID?.trim();
  if (
    (platform === "facebook" || platform === "instagram") &&
    metaConfigId &&
    !/^\d+$/.test(metaConfigId)
  ) {
    throw new Error("Meta login Configuration ID must contain only digits.");
  }

  const state = randomToken();
  const verifier = platform === "x" ? randomToken(48) : null;
  const expiresAt = Date.now() + 10 * 60 * 1000;

  const revisionQuery = env.DB.prepare(
    importClients
      ? "SELECT id,connection_revision FROM social_accounts"
      : "SELECT id,connection_revision FROM social_accounts WHERE client_id=?",
  );
  const revisions = await (importClients ? revisionQuery : revisionQuery.bind(clientId)).all<any>();
  const connectionRevisions = JSON.stringify(
    Object.fromEntries(revisions.results.map((a) => [a.id, a.connection_revision])),
  );
  await env.DB.prepare(
    `INSERT INTO social_oauth_states
     (id, platform, client_id, user_id, state_hash, code_verifier, return_to, expires_at, created_at,connection_revisions,import_clients)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      providerKey(platform),
      importClients ? null : clientId,
      userId,
      await hashSecret(state, env.AUTH_PEPPER || ""),
      verifier,
      returnTo,
      expiresAt,
      Date.now(),
      connectionRevisions,
      importClients ? 1 : 0,
    )
    .run();

  const redirectUri = configuredRedirect(platform, url, env);

  if (platform === "facebook" || platform === "instagram") {
    const auth = new URL("https://www.facebook.com/v23.0/dialog/oauth");
    auth.searchParams.set("client_id", env.META_APP_ID!);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("state", state);
    auth.searchParams.set("response_type", "code");
    if (metaConfigId) {
      // Business Login owns the permissions and assets selected in this configuration.
      auth.searchParams.set("config_id", metaConfigId);
      auth.searchParams.set("override_default_response_type", "true");
      auth.searchParams.set("display", "popup");
      auth.searchParams.set("prompt", "login");
    } else {
      auth.searchParams.set(
        "scope",
        "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management",
      );
    }
    return auth.toString();
  }

  if (platform === "linkedin") {
    const auth = new URL("https://www.linkedin.com/oauth/v2/authorization");
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", env.LINKEDIN_CLIENT_ID!);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("state", state);
    auth.searchParams.set(
      "scope",
      [
        "openid",
        "profile",
        "email",
        "w_member_social",
        ...(env.LINKEDIN_ORGANIZATION_SCOPES || "").split(/\s+/).filter(Boolean),
      ].join(" "),
    );
    return auth.toString();
  }

  if (platform === "tiktok") {
    const auth = new URL("https://www.tiktok.com/v2/auth/authorize/");
    auth.searchParams.set("client_key", env.TIKTOK_CLIENT_KEY!);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "user.info.basic,video.publish,video.upload,video.list");
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("state", state);
    return auth.toString();
  }

  const auth = new URL("https://x.com/i/oauth2/authorize");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", env.X_CLIENT_ID!);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("scope", "tweet.read tweet.write users.read media.write offline.access");
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", await pkceChallenge(verifier!));
  auth.searchParams.set("code_challenge_method", "S256");
  return auth.toString();
}

async function loadOAuthState(env: SocialEnv, state: string) {
  const hash = await hashSecret(state, env.AUTH_PEPPER || "");
  const row = await env.DB.prepare(
    `SELECT * FROM social_oauth_states
     WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
  )
    .bind(hash, Date.now())
    .first<any>();
  if (!row) throw new Error("Social OAuth state is invalid or expired.");
  const claimed = await env.DB.prepare(
    "UPDATE social_oauth_states SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?",
  )
    .bind(Date.now(), row.id, Date.now())
    .run();
  if (!claimed.meta.changes) throw new Error("Social OAuth state is invalid or expired.");
  return row;
}

async function upsertAccount(
  env: SocialEnv,
  input: {
    clientId: string;
    platform: Platform;
    name: string;
    externalId: string;
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: number | null;
    scopes?: string | null;
    metadata?: unknown;
    accountType?: string | null;
    connectedBy?: string | null;
    connectionRevisions?: Record<string, number>;
    newClient?: { name: string; timezone: string };
  },
) {
  const existing = await env.DB.prepare(
    "SELECT id,connection_revision FROM social_accounts WHERE client_id = ? AND platform = ? AND external_account_id = ?",
  )
    .bind(input.clientId, input.platform, input.externalId)
    .first<{ id: string; connection_revision: number }>();

  let id = existing?.id || crypto.randomUUID();
  const access = await encryptSecret(input.accessToken, env);
  const refresh = await encryptSecret(input.refreshToken, env);

  const save = env.DB.prepare(
    `INSERT INTO social_accounts
     (id, client_id, platform, account_name, external_account_id, status,
      access_token_ciphertext, refresh_token_ciphertext, token_expires_at,
      scopes, metadata, account_type, last_verified_at, connected_by, created_at, updated_at,health_status,permission_status)
     SELECT ?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,'healthy','verified'
     WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND status='active')
       AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.status='active' AND
         (u.role='owner' OR EXISTS(SELECT 1 FROM user_client_access a WHERE a.user_id=u.id AND a.client_id=? AND COALESCE(a.permission_role,u.role)='admin')))
     ON CONFLICT(client_id,platform,external_account_id) WHERE external_account_id IS NOT NULL DO UPDATE SET
       connection_revision=social_accounts.connection_revision+1,refresh_claim=NULL,refresh_until=NULL,
       account_name = excluded.account_name,
       status = 'connected',
       health_status = 'healthy',
       health_checked_at = excluded.last_verified_at,
       access_token_ciphertext = excluded.access_token_ciphertext,
       refresh_token_ciphertext = excluded.refresh_token_ciphertext,
       token_expires_at = excluded.token_expires_at,
       scopes = excluded.scopes,
       metadata = excluded.metadata,
       account_type = excluded.account_type,
       last_verified_at = excluded.last_verified_at,
       connected_by = excluded.connected_by,
       updated_at = CURRENT_TIMESTAMP WHERE social_accounts.connection_revision=?`,
  ).bind(
    id,
    input.clientId,
    input.platform,
    input.name,
    input.externalId,
    access,
    refresh,
    input.expiresAt || null,
    input.scopes || null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.accountType || null,
    new Date().toISOString(),
    input.connectedBy || null,
    input.clientId,
    input.connectedBy || null,
    input.clientId,
    existing ? (input.connectionRevisions?.[existing.id] ?? -1) : -1,
  );
  const statements: D1PreparedStatement[] = [];
  if (input.newClient) {
    statements.push(
      env.DB.prepare(`INSERT INTO clients(id,name,timezone,status,created_at,updated_at)
        SELECT ?,?,?,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
        WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND role='owner' AND status='active')
        ON CONFLICT(id) DO NOTHING`).bind(
        input.clientId,
        input.newClient.name,
        input.newClient.timezone,
        input.connectedBy || null,
      ),
      env.DB.prepare(`INSERT INTO brand_profiles(id,client_id)
        SELECT ?,? WHERE EXISTS(SELECT 1 FROM clients WHERE id=? AND status='active')
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND role='owner' AND status='active')
        ON CONFLICT(client_id) DO NOTHING`).bind(
        `brand_${input.clientId}`,
        input.clientId,
        input.clientId,
        input.connectedBy || null,
      ),
    );
  }
  statements.push(save);
  const saved = input.newClient ? (await env.DB.batch(statements)).at(-1)! : await save.run();
  if (!saved.meta.changes) throw new SocialConnectionChanged();
  const stored = await env.DB.prepare(
    "SELECT id FROM social_accounts WHERE client_id=? AND platform=? AND external_account_id=?",
  )
    .bind(input.clientId, input.platform, input.externalId)
    .first<{ id: string }>();
  id = stored!.id;

  const defaultAccount = await env.DB.prepare(
    `SELECT id FROM social_accounts
     WHERE client_id = ? AND platform = ? AND is_default = 1 AND status = 'connected'
     LIMIT 1`,
  )
    .bind(input.clientId, input.platform)
    .first<{ id: string }>();

  if (!defaultAccount) {
    await env.DB.prepare(
      "UPDATE social_accounts SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status='connected'",
    )
      .bind(id)
      .run();
  }

  return id;
}

async function discoverLinkedInOrganizations(
  env: SocialEnv,
  input: {
    clientId: string;
    accessToken: string;
    connectedBy?: string | null;
    connectionRevisions?: Record<string, number>;
    scopes?: string | null;
  },
) {
  const scopeSet = new Set((input.scopes || "").split(/\s+/).filter(Boolean));
  const hasOrgScope =
    scopeSet.has("w_organization_social") ||
    scopeSet.has("r_organization_social") ||
    scopeSet.has("rw_organization_admin");

  if (!hasOrgScope) return [];

  const aclResponse = await providerFetch(
    "https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&state=APPROVED",
    { headers: { authorization: `Bearer ${input.accessToken}` } },
  );
  if (!aclResponse.ok) return [];

  const payload = await aclResponse.json<any>();
  const organizationIds = (payload.elements || [])
    .map((entry: any) => String(entry.organizationalTarget || ""))
    .map((urn: string) => urn.split(":").pop())
    .filter(Boolean);

  const connected: string[] = [];
  for (const organizationId of organizationIds) {
    let name = `LinkedIn Organization ${organizationId}`;
    try {
      const orgResponse = await providerFetch(
        `https://api.linkedin.com/v2/organizations/${organizationId}`,
        { headers: { authorization: `Bearer ${input.accessToken}` } },
      );
      if (orgResponse.ok) {
        const org = await orgResponse.json<any>();
        name = org.localizedName || org.name?.localized?.en_US || name;
      }
    } catch {}

    await upsertAccount(env, {
      clientId: input.clientId,
      platform: "linkedin",
      name,
      externalId: organizationId,
      accessToken: input.accessToken,
      scopes: input.scopes,
      metadata: { organizationUrn: `urn:li:organization:${organizationId}` },
      accountType: "organization",
      connectedBy: input.connectedBy,
      connectionRevisions: input.connectionRevisions,
    });
    connected.push(organizationId);
  }

  return connected;
}

async function validMetaSignature(secret: string, payload: string, signature: string) {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (pair) => parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(payload));
}

export async function handleMetaWebhook(env: SocialEnv, request: Request, url: URL) {
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const verifyToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (
      mode === "subscribe" &&
      env.META_WEBHOOK_VERIFY_TOKEN &&
      verifyToken === env.META_WEBHOOK_VERIFY_TOKEN &&
      challenge
    ) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!env.META_APP_SECRET) return new Response("Meta webhook is not configured.", { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256") || "";
  if (!(await validMetaSignature(env.META_APP_SECRET, raw, signature))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid webhook payload", { status: 400 });
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !Array.isArray(payload.entry)
  )
    return new Response("Invalid webhook payload", { status: 400 });
  // A delivery can contain several entries. Using just the first entry's id/time
  // discards distinct batches that happen to share that first entry.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const eventId =
    "payload:" +
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  await env.DB.prepare(
    `INSERT OR IGNORE INTO social_webhook_events
     (id,provider,event_type,external_event_id,payload_json,processed_at)
     VALUES (?,'meta',?,?,?,CURRENT_TIMESTAMP)`,
  )
    .bind(crypto.randomUUID(), payload?.object || "unknown", eventId, raw)
    .run();

  return new Response("EVENT_RECEIVED", { status: 200 });
}

export async function socialOAuthCallback(
  env: SocialEnv,
  url: URL,
  provider: "meta" | "linkedin" | "tiktok" | "x",
) {
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const oauthError = url.searchParams.get("error");

  const saved = await loadOAuthState(env, state);
  if (saved.platform !== provider)
    throw new Error("Social OAuth provider does not match this connection attempt.");
  const actor = await env.DB.prepare(
    "SELECT id,email,role FROM users WHERE id=? AND status='active'",
  )
    .bind(saved.user_id)
    .first<any>();
  const client = saved.import_clients
    ? null
    : await env.DB.prepare("SELECT id FROM clients WHERE id=? AND status='active'")
        .bind(saved.client_id)
        .first();
  if (
    !actor ||
    (saved.import_clients
      ? actor.role !== "owner" || provider !== "meta"
      : !client || !(await hasClientPermission(env.DB, actor, "social_manage", saved.client_id)))
  )
    throw new Error("Social connection access was revoked.");

  if (oauthError || !code) {
    return redirectWithParams(saved.return_to, {
      social_error: oauthError || "Connection canceled.",
    });
  }

  const connectedClients = new Set<string>();
  let connectedAccounts = 0;
  let connectedInstagram = 0;
  if (provider === "meta") {
    const workspace = await env.DB.prepare(
      "SELECT timezone FROM workspace_settings WHERE id='default'",
    ).first<{ timezone: string }>();
    const redirectUri = env.META_REDIRECT_URI || `${url.origin}/v1/social/meta/callback`;
    const tokenUrl = new URL("https://graph.facebook.com/v23.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", env.META_APP_ID!);
    tokenUrl.searchParams.set("client_secret", env.META_APP_SECRET!);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);
    const tokenResponse = await providerFetch(tokenUrl);
    if (!tokenResponse.ok) throw new Error("Meta token exchange failed.");
    const token = await tokenResponse.json<any>();

    if (typeof token.access_token !== "string" || !token.access_token)
      throw new Error(
        "Meta did not return an access token. Reconnect and grant access to your Pages.",
      );
    const pages = new Map<string, any>();
    const cursors = new Set<string>();
    let after = "";
    for (let batch = 0; ; batch++) {
      const discovery = new URL("https://graph.facebook.com/v23.0/me/accounts");
      discovery.searchParams.set(
        "fields",
        "id,name,access_token,picture.type(square),instagram_business_account{id,username,profile_picture_url}",
      );
      discovery.searchParams.set("access_token", token.access_token);
      discovery.searchParams.set("limit", "100");
      if (after) discovery.searchParams.set("after", after);
      const accountsResponse = await providerFetch(discovery);
      if (!accountsResponse.ok)
        throw new Error("Meta account discovery failed. Check Page permissions and reconnect.");
      const accounts = await accountsResponse.json<any>();
      if (!Array.isArray(accounts.data))
        throw new Error("Meta returned an invalid account list. Reconnect to retry.");
      for (const page of accounts.data) {
        if (typeof page.id !== "string" || !page.id)
          throw new Error("Meta returned an account without an ID.");
        pages.set(page.id, page);
      }
      if (!accounts.paging?.next) break;
      after = accounts.paging?.cursors?.after;
      if (
        typeof after !== "string" ||
        !after ||
        cursors.has(after) ||
        batch >= 99 ||
        pages.size >= 10000
      )
        throw new Error(
          "Meta account discovery could not finish. Reconnect with a smaller selection of Pages.",
        );
      cursors.add(after);
    }
    if (!pages.size)
      return redirectWithParams(saved.return_to, {
        social_error:
          "Meta granted login but returned no Facebook Pages. Grant Page access, select your Pages, and link each professional Instagram account to its Page before reconnecting.",
      });

    for (const page of pages.values()) {
      let destination = saved.client_id as string;
      let newClient: { name: string; timezone: string } | undefined;
      if (saved.import_clients) {
        const matches = await env.DB.prepare(`SELECT DISTINCT client_id FROM social_accounts
          WHERE (platform='facebook' AND external_account_id=?) OR (platform='instagram' AND external_account_id=?)`)
          .bind(page.id, page.instagram_business_account?.id || "")
          .all<{ client_id: string }>();
        if (matches.results.length > 1)
          throw new Error(
            "This Page and Instagram account already belong to multiple clients. Reconnect them from the intended client instead of importing.",
          );
        if (matches.results.length) destination = matches.results[0].client_id;
        else {
          destination = `meta_${await hashSecret(`client:${page.id}`, "social-client-import")}`;
          newClient = {
            name: String(page.name || page.instagram_business_account?.username || "Facebook Page"),
            timezone: workspace?.timezone || "America/New_York",
          };
        }
      }
      await upsertAccount(env, {
        clientId: destination,
        newClient,
        platform: "facebook",
        name: page.name || "Facebook Page",
        externalId: page.id,
        accessToken: page.access_token || token.access_token,
        metadata: { pageId: page.id, profileImageUrl: socialProfileImage(page) },
        accountType: "page",
        connectedBy: saved.user_id,
        connectionRevisions: JSON.parse(saved.connection_revisions || "{}"),
      });
      connectedClients.add(destination);
      connectedAccounts++;

      if (page.instagram_business_account?.id) {
        await upsertAccount(env, {
          clientId: destination,
          platform: "instagram",
          name: page.instagram_business_account.username || page.name || "Instagram",
          externalId: page.instagram_business_account.id,
          accessToken: page.access_token || token.access_token,
          metadata: {
            pageId: page.id,
            profileImageUrl: socialProfileImage(page.instagram_business_account),
          },
          accountType: "business",
          connectedBy: saved.user_id,
          connectionRevisions: JSON.parse(saved.connection_revisions || "{}"),
        });
        connectedAccounts++;
        connectedInstagram++;
      }
    }
  } else if (provider === "linkedin") {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.LINKEDIN_CLIENT_ID!,
      client_secret: env.LINKEDIN_CLIENT_SECRET!,
      redirect_uri: env.LINKEDIN_REDIRECT_URI || `${url.origin}/v1/social/linkedin/callback`,
    });
    const tokenResponse = await providerFetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenResponse.ok) throw new Error("LinkedIn token exchange failed.");
    const token = await tokenResponse.json<any>();
    const profileResponse = await providerFetch("https://api.linkedin.com/v2/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!profileResponse.ok) throw new Error("LinkedIn profile discovery failed.");
    const profile = await profileResponse.json<any>();
    await upsertAccount(env, {
      clientId: saved.client_id,
      platform: "linkedin",
      name: profile.name || profile.email || "LinkedIn",
      externalId: profile.sub,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
      scopes: token.scope,
      metadata: { picture: profile.picture },
      accountType: "member",
      connectedBy: saved.user_id,
      connectionRevisions: JSON.parse(saved.connection_revisions || "{}"),
    });
    await discoverLinkedInOrganizations(env, {
      clientId: saved.client_id,
      accessToken: token.access_token,
      connectedBy: saved.user_id,
      connectionRevisions: JSON.parse(saved.connection_revisions || "{}"),
      scopes: token.scope,
    });
  } else if (provider === "tiktok") {
    const body = new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY!,
      client_secret: env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: env.TIKTOK_REDIRECT_URI || `${url.origin}/v1/social/tiktok/callback`,
    });
    const tokenResponse = await providerFetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenResponse.ok) throw new Error("TikTok token exchange failed.");
    const token = await tokenResponse.json<any>();
    const userResponse = await providerFetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
      { headers: { authorization: `Bearer ${token.access_token}` } },
    );
    const userPayload = userResponse.ok ? await userResponse.json<any>() : {};
    const user = userPayload.data?.user || {};
    await upsertAccount(env, {
      clientId: saved.client_id,
      platform: "tiktok",
      name: user.display_name || "TikTok",
      externalId: token.open_id || user.open_id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
      scopes: token.scope,
      metadata: { avatar: user.avatar_url },
      accountType: "creator",
      connectedBy: saved.user_id,
      connectionRevisions: JSON.parse(saved.connection_revisions || "{}"),
    });
  } else {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.X_CLIENT_ID!,
      redirect_uri: env.X_REDIRECT_URI || `${url.origin}/v1/social/x/callback`,
      code_verifier: saved.code_verifier,
    });
    const basic = env.X_CLIENT_SECRET ? btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`) : null;
    const tokenResponse = await providerFetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(basic ? { authorization: `Basic ${basic}` } : {}),
      },
      body,
    });
    if (!tokenResponse.ok) throw new Error("X token exchange failed.");
    const token = await tokenResponse.json<any>();
    const userResponse = await providerFetch(
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
      {
        headers: { authorization: `Bearer ${token.access_token}` },
      },
    );
    if (!userResponse.ok) throw new Error("X account discovery failed.");
    const user = (await userResponse.json<any>()).data;
    await upsertAccount(env, {
      clientId: saved.client_id,
      platform: "x",
      name: user.username ? `@${user.username}` : user.name || "X",
      externalId: user.id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
      scopes: token.scope,
      metadata: user,
      accountType: "user",
      connectedBy: saved.user_id,
      connectionRevisions: JSON.parse(saved.connection_revisions || "{}"),
    });
  }

  return redirectWithParams(saved.return_to, {
    social_connected: provider,
    ...(provider === "meta"
      ? {
          clientId: [...connectedClients][0],
          connected_accounts: String(connectedAccounts),
          connected_clients: String(connectedClients.size),
          instagram_accounts: String(connectedInstagram),
        }
      : {}),
  });
}

async function createPublicMediaUrl(env: SocialEnv, post: any) {
  if (!post.graphic_key) throw new Error("Post does not have a generated graphic.");
  if (!env.PUBLIC_BASE_URL) throw new Error("PUBLIC_BASE_URL is not configured.");

  const token = randomToken();
  await env.DB.prepare(
    `INSERT INTO publish_media_tokens
     (id, post_id, token_hash, r2_key, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      post.id,
      await hashSecret(token, env.AUTH_PEPPER || ""),
      post.graphic_key,
      Date.now() + 30 * 60 * 1000,
      Date.now(),
    )
    .run();

  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/v1/public/publish-media/${token}`;
}

async function accountToken(env: SocialEnv, account: SocialAccountRow) {
  const authority = await env.DB.prepare(
    "SELECT status,connection_revision,access_token_ciphertext FROM social_accounts WHERE id=?",
  )
    .bind(account.id)
    .first<any>();
  if (
    !authority ||
    authority.status !== "connected" ||
    authority.access_token_ciphertext !== account.access_token_ciphertext ||
    (account.connection_revision !== undefined &&
      account.connection_revision !== authority.connection_revision)
  )
    throw new SocialConnectionChanged();
  account.connection_revision = authority.connection_revision;
  const current = await decryptSecret(account.access_token_ciphertext, env);
  if (!current) throw new Error("Social account token is missing.");

  const expiresAt = Number(account.token_expires_at || 0);
  const needsRefresh = expiresAt > 0 && expiresAt <= Date.now() + 5 * 60 * 1000;
  if (!needsRefresh) return current;

  const refreshToken = await decryptSecret(account.refresh_token_ciphertext, env);
  if (!refreshToken)
    throw new SocialProviderError("Social authorization expired. Reconnect this account.", {
      category: "authorization",
      retryable: false,
    });

  const claim = crypto.randomUUID();
  const claimed =
    await env.DB.prepare(`UPDATE social_accounts SET refresh_claim=?,refresh_until=? WHERE id=? AND status='connected'
    AND connection_revision=? AND access_token_ciphertext IS ? AND (refresh_claim IS NULL OR refresh_until<=?)`)
      .bind(
        claim,
        Date.now() + 90000,
        account.id,
        account.connection_revision,
        account.access_token_ciphertext,
        Date.now(),
      )
      .run();
  if (!claimed.meta.changes)
    throw new SocialConnectionChanged(
      "Connection changed or refresh is already running. Retry shortly.",
    );
  const refreshFetch = (url: string, init: RequestInit) =>
    providerFetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  try {
    let tokenResponse: Response;

    if (account.platform === "linkedin") {
      tokenResponse = await refreshFetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: env.LINKEDIN_CLIENT_ID || "",
          client_secret: env.LINKEDIN_CLIENT_SECRET || "",
        }),
      });
    } else if (account.platform === "tiktok") {
      tokenResponse = await refreshFetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_key: env.TIKTOK_CLIENT_KEY || "",
          client_secret: env.TIKTOK_CLIENT_SECRET || "",
        }),
      });
    } else if (account.platform === "x") {
      const basic =
        env.X_CLIENT_SECRET && env.X_CLIENT_ID
          ? btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)
          : null;
      tokenResponse = await refreshFetch("https://api.x.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...(basic ? { authorization: `Basic ${basic}` } : {}),
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: env.X_CLIENT_ID || "",
        }),
      });
    } else {
      throw new SocialProviderError("Meta authorization expired. Reconnect this account.", {
        category: "authorization",
        retryable: false,
      });
    }

    if (!tokenResponse.ok) {
      throw classifyProviderResponse(
        tokenResponse,
        "Social authorization refresh failed. Try again or reconnect this account.",
      );
    }

    const refreshed = await tokenResponse.json<any>();
    const nextAccess = refreshed.access_token;
    if (typeof nextAccess !== "string" || !nextAccess)
      throw new SocialProviderError("Provider returned no refreshed access token.", {
        category: "temporary",
        retryable: true,
      });
    const nextRefresh = refreshed.refresh_token || refreshToken;
    const nextExpiresAt = refreshed.expires_in
      ? Date.now() + Number(refreshed.expires_in) * 1000
      : null;

    const accessCipher = await encryptSecret(nextAccess, env);
    const refreshedWrite = await env.DB.prepare(
      `UPDATE social_accounts SET
       access_token_ciphertext = ?,
       refresh_token_ciphertext = ?,
       token_expires_at = ?,
       scopes = COALESCE(?, scopes),
       status = 'connected',
       health_status = 'healthy',
       health_checked_at = ?,
       last_error = NULL,
       last_verified_at = ?,
       refresh_claim=NULL,refresh_until=NULL,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status='connected' AND connection_revision=? AND refresh_claim=? AND access_token_ciphertext IS ?`,
    )
      .bind(
        accessCipher,
        await encryptSecret(nextRefresh, env),
        nextExpiresAt,
        refreshed.scope || null,
        new Date().toISOString(),
        new Date().toISOString(),
        account.id,
        account.connection_revision,
        claim,
        account.access_token_ciphertext,
      )
      .run();
    if (!refreshedWrite.meta.changes) throw new SocialConnectionChanged();
    account.access_token_ciphertext = accessCipher;
    return nextAccess;
  } catch (error) {
    if (
      !(error instanceof SocialConnectionChanged) &&
      error instanceof SocialProviderError &&
      error.category === "authorization"
    )
      await env.DB.prepare(`UPDATE social_accounts SET status='reauth_required',health_status='reauth_required',last_error=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND connection_revision=? AND refresh_claim=? AND access_token_ciphertext IS ?`)
        .bind(
          error.message,
          account.id,
          account.connection_revision,
          claim,
          account.access_token_ciphertext,
        )
        .run();
    throw error;
  } finally {
    await env.DB.prepare(
      "UPDATE social_accounts SET refresh_claim=NULL,refresh_until=NULL WHERE id=? AND refresh_claim=?",
    )
      .bind(account.id, claim)
      .run();
  }
}

function uncertainPublication(message: string) {
  return new SocialProviderError(`${message} Check the provider before retrying.`, {
    category: "uncertain",
    retryable: false,
  });
}

// A lost final-submit response is ambiguous: automatic reposting is unsafe.
async function submitPost(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await providerFetch(url, { ...init, signal: AbortSignal.timeout(60000) });
  } catch {
    throw uncertainPublication("Provider submission response was lost.");
  }
  if (response.status >= 500 || response.status === 408)
    throw uncertainPublication(`Provider submission returned ${response.status}.`);
  await requireProviderOk(response, "Provider submission failed");
  return response;
}
async function publicationPayload(response: Response) {
  try {
    return await response.json<any>();
  } catch {
    throw uncertainPublication("Provider returned an unreadable publication receipt.");
  }
}

export async function publishPostToSocial(env: SocialEnv, postId: string) {
  const post = await env.DB.prepare(
    `SELECT p.*, sa.platform, sa.account_name, sa.external_account_id,
            sa.access_token_ciphertext, sa.refresh_token_ciphertext,
            sa.token_expires_at, sa.metadata, sa.account_type
     FROM posts p
     JOIN social_accounts sa ON sa.id = p.social_account_id
     WHERE p.id = ?`,
  )
    .bind(postId)
    .first<any>();

  if (!post) throw new Error("Post or social account not found.");
  const finalCopy = renderFinalCopy(post.caption || "", post.hashtags);
  const copyError = finalCopyError(post.platform, finalCopy);
  if (copyError)
    throw new SocialProviderError(copyError, { category: "permanent", retryable: false });
  const account = { ...post, id: post.social_account_id } as SocialAccountRow;
  const token = await accountToken(env, account);
  const mediaUrl = await createPublicMediaUrl(env, post);

  let providerPostId: string | null = null;
  let providerPostUrl: string | null = null;
  let raw: unknown = null;

  if (post.platform === "instagram") {
    const create = await providerFetch(
      `https://graph.facebook.com/v23.0/${post.external_account_id}/media`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          image_url: mediaUrl,
          caption: finalCopy,
          access_token: token,
        }),
      },
    );
    await requireProviderOk(create, "Instagram media creation failed");
    const container = await create.json<any>();
    const publish = await submitPost(
      `https://graph.facebook.com/v23.0/${post.external_account_id}/media_publish`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: container.id,
          access_token: token,
        }),
      },
    );
    await requireProviderOk(publish, "Instagram publishing failed");
    raw = await publicationPayload(publish);
    providerPostId = (raw as any).id || null;
  } else if (post.platform === "facebook") {
    const publish = await submitPost(
      `https://graph.facebook.com/v23.0/${post.external_account_id}/photos`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          url: mediaUrl,
          caption: finalCopy,
          access_token: token,
        }),
      },
    );
    await requireProviderOk(publish, "Facebook publishing failed");
    raw = await publicationPayload(publish);
    providerPostId = (raw as any).post_id || (raw as any).id || null;
  } else if (post.platform === "linkedin") {
    const owner =
      post.account_type === "organization"
        ? `urn:li:organization:${post.external_account_id}`
        : `urn:li:person:${post.external_account_id}`;
    const init = await providerFetch(
      "https://api.linkedin.com/rest/images?action=initializeUpload",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "LinkedIn-Version": "202610",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({ initializeUploadRequest: { owner } }),
      },
    );
    await requireProviderOk(init, "LinkedIn upload initialization failed");
    const initPayload = await init.json<any>();
    const uploadUrl = initPayload.value?.uploadUrl;
    const imageUrn = initPayload.value?.image;
    const imageResponse = await providerFetch(mediaUrl);
    const imageBlob = await imageResponse.blob();
    const upload = await providerFetch(uploadUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": imageBlob.type || "image/jpeg" },
      body: imageBlob,
    });
    await requireProviderOk(upload, "LinkedIn image upload failed");

    const publish = await submitPost("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "LinkedIn-Version": "202610",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: owner,
        commentary: finalCopy,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: { media: { id: imageUrn } },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    await requireProviderOk(publish, "LinkedIn publishing failed");
    raw = { id: publish.headers.get("x-restli-id") };
    providerPostId = (raw as any).id || null;
  } else if (post.platform === "tiktok") {
    const publish = await submitPost("https://open.tiktokapis.com/v2/post/publish/content/init/", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: finalCopy,
          privacy_level: post.default_visibility || "PUBLIC_TO_EVERYONE",
          disable_comment: false,
          auto_add_music: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_cover_index: 0,
          photo_images: [mediaUrl],
        },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      }),
    });
    await requireProviderOk(publish, "TikTok publishing failed");
    raw = await publicationPayload(publish);
    providerPostId = (raw as any).data?.publish_id || null;
  } else {
    const imageResponse = await providerFetch(mediaUrl);
    const imageBlob = await imageResponse.blob();
    const form = new FormData();
    form.append("media", imageBlob, "brandsparq.jpg");
    form.append("media_category", "tweet_image");
    const media = await providerFetch("https://api.x.com/2/media/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    await requireProviderOk(media, "X media upload failed");
    const mediaPayload = await media.json<any>();
    const mediaId = mediaPayload.data?.id || mediaPayload.media_id_string;
    const publish = await submitPost("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: finalCopy,
        media: { media_ids: [mediaId] },
      }),
    });
    await requireProviderOk(publish, "X publishing failed");
    raw = await publicationPayload(publish);
    providerPostId = (raw as any).data?.id || null;
    if (providerPostId) providerPostUrl = `https://x.com/i/web/status/${providerPostId}`;
  }

  if (!providerPostId) {
    const rejection = (raw as any)?.error;
    if (rejection?.code && rejection.code !== "ok")
      throw new SocialProviderError(
        `Provider rejected publication: ${rejection.message || rejection.code}`,
        { category: "permanent", retryable: false },
      );
    throw uncertainPublication("Provider accepted the request without a publication ID.");
  }

  const receiptId = crypto.randomUUID();
  const asynchronous = post.platform === "tiktok";
  const receiptStatus = asynchronous ? "provider_processing" : "published";
  const providerStatus = asynchronous ? "submitted" : "confirmed";
  const now = new Date().toISOString();

  try {
    const [, saved] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO social_publish_receipts
       (id, post_id, social_account_id, provider_post_id, provider_post_url,
        status, provider_status, last_checked_at, confirmed_at, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        receiptId,
        post.id,
        post.social_account_id,
        providerPostId,
        providerPostUrl,
        receiptStatus,
        providerStatus,
        now,
        asynchronous ? null : now,
        JSON.stringify(raw || {}),
      ),
      env.DB.prepare(
        `UPDATE posts SET
       status = ?,
       platform_post_id = ?,
       platform_url = ?,
       published_at = ?,
       updated_at = ?
       WHERE id = ? AND publish_version=? AND reconciliation_id IS ?`,
      ).bind(
        asynchronous ? "provider_processing" : "published",
        providerPostId,
        providerPostUrl,
        asynchronous ? null : now,
        now,
        post.id,
        post.publish_version,
        post.reconciliation_id,
      ),
    ]);
    if (!saved.meta.changes) throw new Error("Post changed before its provider receipt returned.");
  } catch {
    throw uncertainPublication(
      `Provider accepted publication ${providerPostId}, but saving its receipt failed.`,
    );
  }

  return {
    receiptId,
    providerPostId,
    providerPostUrl,
    raw,
    confirmed: !asynchronous,
    status: receiptStatus,
  };
}

export async function syncAccountAnalytics(env: SocialEnv, accountId: string, onlyPostId?: string) {
  const account = await env.DB.prepare("SELECT * FROM social_accounts WHERE id = ?")
    .bind(accountId)
    .first<SocialAccountRow>();
  if (!account) throw new Error("Social account not found.");

  const runId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO analytics_sync_runs (id, social_account_id, status) VALUES (?, ?, 'running')",
  )
    .bind(runId, accountId)
    .run();

  const analyticsFetch = (input: string, init: RequestInit = {}) =>
    providerFetch(input, { ...init, signal: AbortSignal.timeout(15000) });
  try {
    const posts = await env.DB.prepare(
      `SELECT id, platform_post_id FROM posts
       WHERE social_account_id = ? AND status = 'published' AND platform_post_id IS NOT NULL
       AND (? IS NULL OR id=?) ORDER BY published_at DESC,id LIMIT 1000`,
    )
      .bind(accountId, onlyPostId || null, onlyPostId || null)
      .all<{ id: string; platform_post_id: string }>();

    if (account.platform === "linkedin" && account.account_type !== "organization") {
      await env.DB.prepare(
        "UPDATE analytics_sync_runs SET status='unsupported', completed_at=?, error_message=? WHERE id=?",
      )
        .bind(
          new Date().toISOString(),
          "LinkedIn member analytics are unavailable for this integration.",
          runId,
        )
        .run();
      return { runId, status: "unsupported" };
    }
    const token = posts.results.length ? await accountToken(env, account) : "";
    const failures: string[] = [];
    for (const post of posts.results) {
      try {
        let metrics: any = {};
        if (account.platform === "x") {
          const result = await analyticsFetch(
            `https://api.x.com/2/tweets/${post.platform_post_id}?tweet.fields=public_metrics`,
            { headers: { authorization: `Bearer ${token}` } },
          );
          if (result.ok) {
            const payload = await result.json<any>();
            const m = payload.data?.public_metrics || {};
            metrics = {
              impressions: m.impression_count,
              likes: m.like_count,
              comments: m.reply_count,
              shares: m.retweet_count,
              raw: payload,
            };
          }
        } else if (account.platform === "instagram") {
          const result = await analyticsFetch(
            `https://graph.facebook.com/v23.0/${post.platform_post_id}/insights?metric=views,reach,likes,comments,saved,shares&access_token=${encodeURIComponent(token)}`,
          );
          if (result.ok) {
            const payload = await result.json<any>();
            const byName = Object.fromEntries(
              (payload.data || []).map((m: any) => [
                m.name,
                m.values?.[0]?.value ?? m.total_value?.value,
              ]),
            );
            metrics = {
              impressions: byName.views ?? byName.impressions,
              reach: byName.reach,
              likes: byName.likes,
              comments: byName.comments,
              shares: byName.shares,
              saves: byName.saved,
              raw: payload,
            };
          }
        } else if (account.platform === "facebook") {
          const insights = await analyticsFetch(
            `https://graph.facebook.com/v23.0/${post.platform_post_id}/insights?metric=post_media_view,post_total_media_view_unique,post_clicks,post_reactions_by_type_total&access_token=${encodeURIComponent(token)}`,
          );
          const engagement = await analyticsFetch(
            `https://graph.facebook.com/v23.0/${post.platform_post_id}?fields=comments.limit(0).summary(true),shares&access_token=${encodeURIComponent(token)}`,
          );
          if (insights.ok && engagement.ok) {
            const insightPayload = insights.ok ? await insights.json<any>() : {};
            const engagementPayload = engagement.ok ? await engagement.json<any>() : {};
            const byName = Object.fromEntries(
              (insightPayload.data || []).map((m: any) => [
                m.name,
                m.values?.[0]?.value ?? m.total_value?.value,
              ]),
            );
            const reactions = byName.post_reactions_by_type_total;
            const likes =
              reactions == null
                ? undefined
                : typeof reactions === "number"
                  ? reactions
                  : Object.values(reactions).reduce(
                      (sum: number, value: any) => sum + Number(value || 0),
                      0,
                    );
            metrics = {
              impressions: byName.post_media_view,
              reach: byName.post_total_media_view_unique,
              likes,
              comments: engagementPayload?.comments?.summary?.total_count,
              shares: engagementPayload?.shares?.count,
              clicks: byName.post_clicks,
              raw: { insights: insightPayload, engagement: engagementPayload },
            };
          }
        } else if (account.platform === "tiktok") {
          const result = await analyticsFetch(
            "https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count",
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                filters: { video_ids: [String(post.platform_post_id)] },
              }),
            },
          );
          if (result.ok) {
            const payload = await result.json<any>();
            const video = payload?.data?.videos?.[0] || {};
            metrics = {
              impressions: video.view_count,
              reach: video.view_count,
              likes: video.like_count,
              comments: video.comment_count,
              shares: video.share_count,
              raw: payload,
            };
          }
        } else if (account.platform === "linkedin" && account.account_type === "organization") {
          const postUrn = String(post.platform_post_id);
          const parameter = postUrn.includes(":ugcPost:") ? "ugcPosts" : "shares";
          const orgUrn = `urn:li:organization:${account.external_account_id}`;
          const query = new URL(
            "https://api.linkedin.com/rest/organizationalEntityShareStatistics",
          );
          query.searchParams.set("q", "organizationalEntity");
          query.searchParams.set("organizationalEntity", orgUrn);
          query.searchParams.set(parameter, `List(${postUrn})`);
          const result = await analyticsFetch(query.toString(), {
            headers: {
              authorization: `Bearer ${token}`,
              "LinkedIn-Version": "202610",
              "X-Restli-Protocol-Version": "2.0.0",
            },
          });
          if (result.ok) {
            const payload = await result.json<any>();
            const stats = payload?.elements?.[0]?.totalShareStatistics || {};
            metrics = {
              impressions: stats.impressionCount,
              reach: stats.uniqueImpressionsCount ?? stats.uniqueImpressionsCounts,
              likes: stats.likeCount,
              comments: stats.commentCount,
              shares: stats.shareCount,
              clicks: stats.clickCount,
              raw: payload,
            };
          }
        }

        const metricKeys = [
          "impressions",
          "reach",
          "likes",
          "comments",
          "shares",
          "clicks",
          "saves",
        ];
        if (
          !metricKeys.some(
            (key) => typeof metrics[key] === "number" && Number.isFinite(metrics[key]),
          )
        )
          throw new Error("Provider returned no usable analytics. Previous measurements retained.");
        for (const key of metricKeys)
          if (
            metrics[key] !== undefined &&
            (typeof metrics[key] !== "number" || !Number.isFinite(metrics[key]) || metrics[key] < 0)
          )
            throw new Error("Provider returned invalid analytics. Previous measurements retained.");
        await env.DB.prepare(
          `INSERT INTO post_metrics
         (id, post_id, platform, impressions, reach, likes, comments, shares, clicks, saves, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            crypto.randomUUID(),
            post.id,
            account.platform,
            metrics.impressions ?? null,
            metrics.reach ?? null,
            metrics.likes ?? null,
            metrics.comments ?? null,
            metrics.shares ?? null,
            metrics.clicks ?? null,
            metrics.saves ?? null,
            JSON.stringify(metrics.raw || { status: "not_available_for_provider" }),
          )
          .run();
      } catch {
        failures.push(post.id);
      }
    }
    // Successful posts retain their new samples; failed posts keep their last good sample.
    if (failures.length)
      throw new Error(
        `Analytics unavailable for ${failures.length} of ${posts.results.length} posts. Previous measurements retained; retry the sync.`,
      );

    const completedAt = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE analytics_sync_runs SET status = 'completed', completed_at = ? WHERE id = ?",
    )
      .bind(completedAt, runId)
      .run();

    const platformTotals = await env.DB.prepare(
      `SELECT
         COUNT(DISTINCT p.id) AS posts,
         SUM(COALESCE(pm.impressions,0)) AS impressions,
         SUM(COALESCE(pm.reach,0)) AS reach,
         SUM(COALESCE(pm.likes,0)) AS likes,
         SUM(COALESCE(pm.comments,0)) AS comments,
         SUM(COALESCE(pm.shares,0)) AS shares,
         SUM(COALESCE(pm.clicks,0)) AS clicks,
         SUM(COALESCE(pm.saves,0)) AS saves
       FROM posts p
       ${latestMetricsJoin}
       WHERE p.client_id=? AND p.platform=? AND p.status='published'`,
    )
      .bind(account.client_id, account.platform)
      .first<any>();

    const day = completedAt.slice(0, 10);
    await env.DB.prepare(
      `INSERT INTO analytics_daily
       (id,client_id,platform,day,posts,impressions,reach,likes,comments,shares,clicks,saves)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(client_id,platform,day) DO UPDATE SET
         posts=excluded.posts,
         impressions=excluded.impressions,
         reach=excluded.reach,
         likes=excluded.likes,
         comments=excluded.comments,
         shares=excluded.shares,
         clicks=excluded.clicks,
         saves=excluded.saves,
         updated_at=CURRENT_TIMESTAMP`,
    )
      .bind(
        crypto.randomUUID(),
        account.client_id,
        account.platform,
        day,
        Number(platformTotals?.posts || 0),
        Number(platformTotals?.impressions || 0),
        Number(platformTotals?.reach || 0),
        Number(platformTotals?.likes || 0),
        Number(platformTotals?.comments || 0),
        Number(platformTotals?.shares || 0),
        Number(platformTotals?.clicks || 0),
        Number(platformTotals?.saves || 0),
      )
      .run();

    const clientTotals = await env.DB.prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN p.status='published' THEN p.id END) AS posts,
         SUM(COALESCE(pm.impressions,0)) AS impressions,
         SUM(COALESCE(pm.reach,0)) AS reach,
         SUM(COALESCE(pm.likes,0)) AS likes,
         SUM(COALESCE(pm.comments,0)) AS comments,
         SUM(COALESCE(pm.shares,0)) AS shares,
         SUM(COALESCE(pm.clicks,0)) AS clicks,
         SUM(COALESCE(pm.saves,0)) AS saves
       FROM posts p
       ${latestMetricsJoin}
       WHERE p.client_id=?`,
    )
      .bind(account.client_id)
      .first<any>();

    await env.DB.prepare(
      `INSERT INTO analytics_snapshots
       (id,client_id,posts,impressions,reach,likes,comments,shares,clicks,saves,captured_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        crypto.randomUUID(),
        account.client_id,
        Number(clientTotals?.posts || 0),
        Number(clientTotals?.impressions || 0),
        Number(clientTotals?.reach || 0),
        Number(clientTotals?.likes || 0),
        Number(clientTotals?.comments || 0),
        Number(clientTotals?.shares || 0),
        Number(clientTotals?.clicks || 0),
        Number(clientTotals?.saves || 0),
        completedAt,
      )
      .run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE analytics_sync_runs SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?",
    )
      .bind(
        new Date().toISOString(),
        error instanceof Error ? error.message.slice(0, 1000) : "Analytics sync failed",
        runId,
      )
      .run();
    throw error;
  }

  return { runId, status: "completed" };
}

export async function renewClientDestinations(
  env: SocialEnv,
  clientId: string,
  accountId?: string | null,
) {
  const rows =
    await env.DB.prepare(`SELECT * FROM social_accounts WHERE client_id=? AND status='connected'
 AND (? IS NULL OR id=?) AND token_expires_at IS NOT NULL AND token_expires_at<=? AND refresh_token_ciphertext IS NOT NULL`)
      .bind(clientId, accountId || null, accountId || null, Date.now() + 5 * 60000)
      .all<SocialAccountRow>();
  for (const account of rows.results) await accountToken(env, account);
}

export async function resolveDefaultSocialAccount(
  env: SocialEnv,
  clientId: string,
  platform: Platform,
) {
  await renewClientDestinations(env, clientId);
  const preferred = await env.DB.prepare(
    `SELECT id, account_name
     FROM social_accounts
     WHERE client_id = ? AND platform = ? AND status = 'connected' AND access_token_ciphertext IS NOT NULL AND COALESCE(health_status,'healthy') NOT IN ('reauth_required','degraded','disconnected') AND (token_expires_at IS NULL OR token_expires_at>unixepoch('now')*1000)
     ORDER BY is_default DESC, created_at ASC
     LIMIT 2`,
  )
    .bind(clientId, platform)
    .all<{ id: string; account_name: string | null }>();

  if (!preferred.results.length) return null;

  const explicitDefault = await env.DB.prepare(
    `SELECT id, account_name
     FROM social_accounts
     WHERE client_id = ? AND platform = ? AND status = 'connected' AND access_token_ciphertext IS NOT NULL AND COALESCE(health_status,'healthy') NOT IN ('reauth_required','degraded','disconnected') AND (token_expires_at IS NULL OR token_expires_at>unixepoch('now')*1000) AND is_default = 1
     LIMIT 1`,
  )
    .bind(clientId, platform)
    .first<{ id: string; account_name: string | null }>();

  if (explicitDefault) return explicitDefault;
  if (preferred.results.length === 1) return preferred.results[0];
  return null;
}

export async function ensurePostSocialDestination(
  env: SocialEnv,
  post: {
    id: string;
    client_id: string;
    platform: Platform;
    social_account_id?: string | null;
    content_revision?: number;
  },
) {
  if (post.social_account_id) {
    await renewClientDestinations(env, post.client_id, post.social_account_id);
    const assigned = await env.DB.prepare(
      `SELECT id, account_name
       FROM social_accounts
       WHERE id = ? AND client_id = ? AND platform = ? AND status = 'connected' AND access_token_ciphertext IS NOT NULL AND COALESCE(health_status,'healthy') NOT IN ('reauth_required','degraded','disconnected') AND (token_expires_at IS NULL OR token_expires_at>unixepoch('now')*1000)`,
    )
      .bind(post.social_account_id, post.client_id, post.platform)
      .first<{ id: string; account_name: string | null }>();

    return assigned ? { ...assigned, contentRevision: post.content_revision } : null;
  }

  const fallback = await resolveDefaultSocialAccount(env, post.client_id, post.platform);
  if (!fallback) return null;

  const current = await env.DB.prepare("SELECT content_revision,status FROM posts WHERE id=?")
    .bind(post.id)
    .first<any>();
  if (
    !current ||
    (post.content_revision !== undefined && current.content_revision !== post.content_revision)
  )
    return null;
  const changed =
    await env.DB.prepare(`UPDATE posts SET social_account_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
    AND social_account_id IS NULL AND content_revision=? AND status=?`)
      .bind(fallback.id, post.id, current.content_revision, current.status)
      .run();
  return changed.meta.changes
    ? { ...fallback, contentRevision: current.content_revision + 1 }
    : null;
}

export async function verifySocialAccount(env: SocialEnv, accountId: string) {
  const account = await env.DB.prepare("SELECT * FROM social_accounts WHERE id = ?")
    .bind(accountId)
    .first<SocialAccountRow>();
  if (!account) throw new Error("Social account not found.");

  try {
    const token = await accountToken(env, account);
    let response: Response;

    if (account.platform === "facebook" || account.platform === "instagram") {
      const fields =
        account.platform === "facebook"
          ? "id,name,picture.type(square)"
          : "id,name,username,profile_picture_url";
      response = await providerFetch(
        `https://graph.facebook.com/v23.0/${account.external_account_id}?fields=${fields}&access_token=${encodeURIComponent(token)}`,
      );
    } else if (account.platform === "linkedin") {
      response = await providerFetch("https://api.linkedin.com/v2/userinfo", {
        headers: { authorization: `Bearer ${token}` },
      });
    } else if (account.platform === "tiktok") {
      response = await providerFetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
        { headers: { authorization: `Bearer ${token}` } },
      );
    } else {
      response = await providerFetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
        headers: { authorization: `Bearer ${token}` },
      });
    }

    await requireProviderOk(response, "Social connection verification failed");
    const profile = await response.json<any>().catch(() => null);
    const image = socialProfileImage(profile?.data?.user || profile?.data || profile);
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(account.metadata || "{}");
    } catch {}
    const now = new Date().toISOString();

    const verified = await env.DB.prepare(
      `UPDATE social_accounts SET
       status='connected',
       health_status='healthy',
       health_checked_at=?,
       permission_status='verified',
       last_verified_at=?,
       last_error=NULL,
       metadata=CASE WHEN ? IS NULL THEN metadata ELSE ? END,
       updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND status='connected' AND connection_revision=? AND access_token_ciphertext IS ?`,
    )
      .bind(
        now,
        now,
        image,
        JSON.stringify({ ...metadata, profileImageUrl: image }),
        accountId,
        account.connection_revision,
        account.access_token_ciphertext,
      )
      .run();

    if (!verified.meta.changes) throw new SocialConnectionChanged();
    return { ok: true, health: "healthy", checkedAt: now };
  } catch (error) {
    if (error instanceof SocialConnectionChanged) throw error;
    const providerError = error instanceof SocialProviderError ? error : null;
    const reauth = providerError?.category === "authorization";
    const health = reauth ? "reauth_required" : "degraded";
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Verification failed";

    await env.DB.prepare(
      `UPDATE social_accounts SET
       status=CASE WHEN ? THEN 'reauth_required' ELSE status END,
       health_status=?,
       health_checked_at=?,
       permission_status=?,
       last_error=?,
       rate_limit_reset_at=?,
       updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND status='connected' AND connection_revision=? AND access_token_ciphertext IS ?`,
    )
      .bind(
        reauth ? 1 : 0,
        health,
        new Date().toISOString(),
        reauth ? "reauth_required" : "unknown",
        message,
        providerError?.retryAfterSeconds
          ? new Date(Date.now() + providerError.retryAfterSeconds * 1000).toISOString()
          : null,
        accountId,
        account.connection_revision,
        account.access_token_ciphertext,
      )
      .run();

    throw error;
  }
}

export async function checkPublishReceipt(env: SocialEnv, receiptId: string) {
  const receipt = await env.DB.prepare(
    `SELECT r.*, sa.platform, sa.access_token_ciphertext,
            sa.refresh_token_ciphertext, sa.token_expires_at,
            sa.external_account_id, sa.metadata, sa.account_type
     FROM social_publish_receipts r
     JOIN social_accounts sa ON sa.id = r.social_account_id
     WHERE r.id = ?`,
  )
    .bind(receiptId)
    .first<any>();

  if (!receipt) throw new Error("Publish receipt not found.");
  if (receipt.status === "published" || receipt.status === "failed") {
    return {
      status: receipt.status,
      providerStatus: receipt.provider_status,
      postId: receipt.post_id,
      receiptId,
    };
  }

  const account = { ...receipt, id: receipt.social_account_id } as SocialAccountRow;
  const token = await accountToken(env, account);

  if (receipt.platform !== "tiktok") {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE social_publish_receipts SET
         status='published',provider_status='confirmed',
         last_checked_at=?,confirmed_at=COALESCE(confirmed_at,?)
         WHERE id=?`,
      ).bind(now, now, receiptId),
      env.DB.prepare(
        `UPDATE posts SET
         status='published',
         published_at=COALESCE(published_at,?),
         updated_at=?
         WHERE id=? AND status='provider_processing' AND platform_post_id=?`,
      ).bind(now, now, receipt.post_id, receipt.provider_post_id),
    ]);
    return {
      status: "published",
      providerStatus: "confirmed",
      postId: receipt.post_id,
      receiptId,
    };
  }

  const response = await providerFetch(
    "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ publish_id: receipt.provider_post_id }),
    },
  );
  await requireProviderOk(response, "TikTok publish status check failed");
  const payload = await response.json<any>();
  const providerStatus = String(
    payload?.data?.status || payload?.data?.publish_status || "PROCESSING",
  ).toUpperCase();
  const now = new Date().toISOString();

  const complete =
    providerStatus.includes("COMPLETE") ||
    providerStatus.includes("PUBLISHED") ||
    providerStatus === "SUCCESS";
  const failed =
    providerStatus.includes("FAIL") ||
    providerStatus.includes("ERROR") ||
    providerStatus.includes("REJECT");

  await env.DB.prepare(
    `INSERT INTO social_status_checks
     (id,receipt_id,social_account_id,platform,status,provider_status,error_message)
     VALUES (?,?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      receiptId,
      receipt.social_account_id,
      receipt.platform,
      complete ? "published" : failed ? "failed" : "provider_processing",
      providerStatus,
      failed ? JSON.stringify(payload).slice(0, 1000) : null,
    )
    .run();

  if (complete) {
    const publicPostId = Array.isArray(payload?.data?.publicaly_available_post_id)
      ? payload.data.publicaly_available_post_id[0]
      : null;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE social_publish_receipts SET
         status='published',provider_status=?,last_checked_at=?,confirmed_at=?,
         provider_post_id=COALESCE(?,provider_post_id)
         WHERE id=?`,
      ).bind(providerStatus, now, now, publicPostId ? String(publicPostId) : null, receiptId),
      env.DB.prepare(
        `UPDATE posts SET
         status='published',
         platform_post_id=COALESCE(?,platform_post_id),
         published_at=COALESCE(published_at,?),
         updated_at=?
         WHERE id=? AND status='provider_processing' AND platform_post_id=?`,
      ).bind(
        publicPostId ? String(publicPostId) : null,
        now,
        now,
        receipt.post_id,
        receipt.provider_post_id,
      ),
    ]);
    return {
      status: "published",
      providerStatus,
      postId: receipt.post_id,
      receiptId,
    };
  }

  if (failed) {
    const detail = JSON.stringify(payload).slice(0, 1500);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE social_publish_receipts SET
         status='failed',provider_status=?,last_checked_at=?,
         error_category='permanent',error_code='PROVIDER_REJECTED'
         WHERE id=?`,
      ).bind(providerStatus, now, receiptId),
      env.DB.prepare(
        `UPDATE posts SET
         status='failed',
         failure_code='PROVIDER_REJECTED',
         failure_message=?,
         updated_at=?
         WHERE id=? AND status='provider_processing' AND platform_post_id=?`,
      ).bind(detail, now, receipt.post_id, receipt.provider_post_id),
    ]);
    return {
      status: "failed",
      providerStatus,
      postId: receipt.post_id,
      receiptId,
    };
  }

  await env.DB.prepare(
    `UPDATE social_publish_receipts SET
     status='provider_processing',provider_status=?,last_checked_at=?
     WHERE id=?`,
  )
    .bind(providerStatus, now, receiptId)
    .run();

  return {
    status: "provider_processing",
    providerStatus,
    postId: receipt.post_id,
    receiptId,
  };
}

export async function checkPendingPublishReceipts(env: SocialEnv, limit = 25) {
  const rows = await env.DB.prepare(
    `SELECT id FROM social_publish_receipts
     WHERE status='provider_processing'
     ORDER BY COALESCE(last_checked_at, created_at) ASC
     LIMIT ?`,
  )
    .bind(limit)
    .all<{ id: string }>();

  const results = [];
  for (const row of rows.results) {
    try {
      results.push(await checkPublishReceipt(env, row.id));
    } catch {}
  }
  return results;
}

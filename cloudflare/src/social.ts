import { decryptSecret, encryptSecret, hashSecret } from "./security";

export interface SocialEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  SOCIAL_TOKEN_KEY?: string;
  AUTH_PEPPER?: string;
  PUBLIC_BASE_URL?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_REDIRECT_URI?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_REDIRECT_URI?: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  TIKTOK_REDIRECT_URI?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_REDIRECT_URI?: string;
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
};

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
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
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

function validReturnTo(value: string, requestOrigin: string) {
  try {
    const target = new URL(value);
    return (
      target.protocol === "brandsparq:" ||
      target.origin === requestOrigin ||
      (target.protocol === "http:" &&
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
  returnTo: string
) {
  if (!providerConfigured(platform, env)) {
    throw new Error(`${platform} OAuth is not configured.`);
  }
  if (!validReturnTo(returnTo, url.origin)) {
    throw new Error("Invalid social OAuth return URL.");
  }

  const state = randomToken();
  const verifier = platform === "x" ? randomToken(48) : null;
  const expiresAt = Date.now() + 10 * 60 * 1000;

  await env.DB.prepare(
    `INSERT INTO social_oauth_states
     (id, platform, client_id, user_id, state_hash, code_verifier, return_to, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      providerKey(platform),
      clientId,
      userId,
      await hashSecret(state, env.AUTH_PEPPER || ""),
      verifier,
      returnTo,
      expiresAt,
      Date.now()
    )
    .run();

  const redirectUri = configuredRedirect(platform, url, env);

  if (platform === "facebook" || platform === "instagram") {
    const auth = new URL("https://www.facebook.com/v23.0/dialog/oauth");
    auth.searchParams.set("client_id", env.META_APP_ID!);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("state", state);
    auth.searchParams.set(
      "scope",
      "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management"
    );
    return auth.toString();
  }

  if (platform === "linkedin") {
    const auth = new URL("https://www.linkedin.com/oauth/v2/authorization");
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", env.LINKEDIN_CLIENT_ID!);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("state", state);
    auth.searchParams.set("scope", "openid profile email w_member_social");
    return auth.toString();
  }

  if (platform === "tiktok") {
    const auth = new URL("https://www.tiktok.com/v2/auth/authorize/");
    auth.searchParams.set("client_key", env.TIKTOK_CLIENT_KEY!);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "user.info.basic,video.publish,video.upload");
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
     WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`
  )
    .bind(hash, Date.now())
    .first<any>();
  if (!row) throw new Error("Social OAuth state is invalid or expired.");
  await env.DB.prepare("UPDATE social_oauth_states SET consumed_at = ? WHERE id = ?")
    .bind(Date.now(), row.id)
    .run();
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
  }
) {
  const existing = await env.DB.prepare(
    "SELECT id FROM social_accounts WHERE client_id = ? AND platform = ? AND external_account_id = ?"
  )
    .bind(input.clientId, input.platform, input.externalId)
    .first<{ id: string }>();

  const id = existing?.id || crypto.randomUUID();
  const access = await encryptSecret(input.accessToken, env);
  const refresh = await encryptSecret(input.refreshToken, env);

  await env.DB.prepare(
    `INSERT INTO social_accounts
     (id, client_id, platform, account_name, external_account_id, status,
      access_token_ciphertext, refresh_token_ciphertext, token_expires_at,
      scopes, metadata, account_type, last_verified_at, connected_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       account_name = excluded.account_name,
       status = 'connected',
       access_token_ciphertext = excluded.access_token_ciphertext,
       refresh_token_ciphertext = excluded.refresh_token_ciphertext,
       token_expires_at = excluded.token_expires_at,
       scopes = excluded.scopes,
       metadata = excluded.metadata,
       account_type = excluded.account_type,
       last_verified_at = excluded.last_verified_at,
       connected_by = excluded.connected_by,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
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
      input.connectedBy || null
    )
    .run();

  const defaultAccount = await env.DB.prepare(
    `SELECT id FROM social_accounts
     WHERE client_id = ? AND platform = ? AND is_default = 1 AND status = 'connected'
     LIMIT 1`
  ).bind(input.clientId, input.platform).first<{ id: string }>();

  if (!defaultAccount) {
    await env.DB.prepare(
      "UPDATE social_accounts SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(id).run();
  }

  return id;
}

export async function socialOAuthCallback(
  env: SocialEnv,
  url: URL,
  provider: "meta" | "linkedin" | "tiktok" | "x"
) {
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const oauthError = url.searchParams.get("error");

  const saved = await loadOAuthState(env, state);
  if (oauthError || !code) {
    return redirectWithParams(saved.return_to, {
      social_error: oauthError || "Connection canceled.",
    });
  }

  if (provider === "meta") {
    const redirectUri = env.META_REDIRECT_URI || `${url.origin}/v1/social/meta/callback`;
    const tokenUrl = new URL("https://graph.facebook.com/v23.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", env.META_APP_ID!);
    tokenUrl.searchParams.set("client_secret", env.META_APP_SECRET!);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);
    const tokenResponse = await fetch(tokenUrl);
    if (!tokenResponse.ok) throw new Error("Meta token exchange failed.");
    const token = await tokenResponse.json<any>();

    const accountsResponse = await fetch(
      `https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(token.access_token)}`
    );
    if (!accountsResponse.ok) throw new Error("Meta account discovery failed.");
    const accounts = await accountsResponse.json<any>();

    for (const page of accounts.data || []) {
      await upsertAccount(env, {
        clientId: saved.client_id,
        platform: "facebook",
        name: page.name || "Facebook Page",
        externalId: page.id,
        accessToken: page.access_token || token.access_token,
        metadata: { pageId: page.id },
        accountType: "page",
        connectedBy: saved.user_id,
      });

      if (page.instagram_business_account?.id) {
        await upsertAccount(env, {
          clientId: saved.client_id,
          platform: "instagram",
          name: page.instagram_business_account.username || page.name || "Instagram",
          externalId: page.instagram_business_account.id,
          accessToken: page.access_token || token.access_token,
          metadata: { pageId: page.id },
          accountType: "business",
          connectedBy: saved.user_id,
        });
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
    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenResponse.ok) throw new Error("LinkedIn token exchange failed.");
    const token = await tokenResponse.json<any>();
    const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
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
    });
  } else if (provider === "tiktok") {
    const body = new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY!,
      client_secret: env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: env.TIKTOK_REDIRECT_URI || `${url.origin}/v1/social/tiktok/callback`,
    });
    const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenResponse.ok) throw new Error("TikTok token exchange failed.");
    const token = await tokenResponse.json<any>();
    const userResponse = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
      { headers: { authorization: `Bearer ${token.access_token}` } }
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
    });
  } else {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.X_CLIENT_ID!,
      redirect_uri: env.X_REDIRECT_URI || `${url.origin}/v1/social/x/callback`,
      code_verifier: saved.code_verifier,
    });
    const basic = env.X_CLIENT_SECRET
      ? btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)
      : null;
    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(basic ? { authorization: `Basic ${basic}` } : {}),
      },
      body,
    });
    if (!tokenResponse.ok) throw new Error("X token exchange failed.");
    const token = await tokenResponse.json<any>();
    const userResponse = await fetch("https://api.x.com/2/users/me", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
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
    });
  }

  return redirectWithParams(saved.return_to, {
    social_connected: provider,
  });
}

async function createPublicMediaUrl(env: SocialEnv, post: any) {
  if (!post.graphic_key) throw new Error("Post does not have a generated graphic.");
  if (!env.PUBLIC_BASE_URL) throw new Error("PUBLIC_BASE_URL is not configured.");

  const token = randomToken();
  await env.DB.prepare(
    `INSERT INTO publish_media_tokens
     (id, post_id, token_hash, r2_key, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      post.id,
      await hashSecret(token, env.AUTH_PEPPER || ""),
      post.graphic_key,
      Date.now() + 30 * 60 * 1000,
      Date.now()
    )
    .run();

  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/v1/public/publish-media/${token}`;
}

async function accountToken(env: SocialEnv, account: SocialAccountRow) {
  const current = await decryptSecret(account.access_token_ciphertext, env);
  if (!current) throw new Error("Social account token is missing.");

  const expiresAt = Number(account.token_expires_at || 0);
  const needsRefresh = expiresAt > 0 && expiresAt <= Date.now() + 5 * 60 * 1000;
  if (!needsRefresh) return current;

  const refreshToken = await decryptSecret(account.refresh_token_ciphertext, env);
  if (!refreshToken) {
    await env.DB.prepare(
      "UPDATE social_accounts SET status = 'reauth_required', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind("Access token expired and no refresh token is available.", account.id).run();
    throw new Error("Social authorization expired. Reconnect this account.");
  }

  let tokenResponse: Response;

  if (account.platform === "linkedin") {
    tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
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
    tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
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
    tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
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
    await env.DB.prepare(
      "UPDATE social_accounts SET status = 'reauth_required', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind("Meta authorization expired. Reconnect this account.", account.id).run();
    throw new Error("Meta authorization expired. Reconnect this account.");
  }

  if (!tokenResponse.ok) {
    const detail = (await tokenResponse.text()).slice(0, 500);
    await env.DB.prepare(
      "UPDATE social_accounts SET status = 'reauth_required', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(`Token refresh failed: ${detail}`, account.id).run();
    throw new Error("Social authorization refresh failed. Reconnect this account.");
  }

  const refreshed = await tokenResponse.json<any>();
  const nextAccess = refreshed.access_token;
  const nextRefresh = refreshed.refresh_token || refreshToken;
  const nextExpiresAt = refreshed.expires_in
    ? Date.now() + Number(refreshed.expires_in) * 1000
    : null;

  await env.DB.prepare(
    `UPDATE social_accounts SET
       access_token_ciphertext = ?,
       refresh_token_ciphertext = ?,
       token_expires_at = ?,
       scopes = COALESCE(?, scopes),
       status = 'connected',
       last_error = NULL,
       last_verified_at = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(
    await encryptSecret(nextAccess, env),
    await encryptSecret(nextRefresh, env),
    nextExpiresAt,
    refreshed.scope || null,
    new Date().toISOString(),
    account.id
  ).run();

  return nextAccess;
}

export async function publishPostToSocial(env: SocialEnv, postId: string) {
  const post = await env.DB.prepare(
    `SELECT p.*, sa.platform, sa.account_name, sa.external_account_id,
            sa.access_token_ciphertext, sa.refresh_token_ciphertext,
            sa.token_expires_at, sa.metadata, sa.account_type
     FROM posts p
     JOIN social_accounts sa ON sa.id = p.social_account_id
     WHERE p.id = ?`
  ).bind(postId).first<any>();

  if (!post) throw new Error("Post or social account not found.");
  const account = post as SocialAccountRow;
  const token = await accountToken(env, account);
  const mediaUrl = await createPublicMediaUrl(env, post);

  let providerPostId: string | null = null;
  let providerPostUrl: string | null = null;
  let raw: unknown = null;

  if (post.platform === "instagram") {
    const create = await fetch(
      `https://graph.facebook.com/v23.0/${post.external_account_id}/media`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          image_url: mediaUrl,
          caption: post.caption || "",
          access_token: token,
        }),
      }
    );
    if (!create.ok) throw new Error(`Instagram media creation failed: ${await create.text()}`);
    const container = await create.json<any>();
    const publish = await fetch(
      `https://graph.facebook.com/v23.0/${post.external_account_id}/media_publish`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: container.id,
          access_token: token,
        }),
      }
    );
    if (!publish.ok) throw new Error(`Instagram publishing failed: ${await publish.text()}`);
    raw = await publish.json<any>();
    providerPostId = (raw as any).id || null;
  } else if (post.platform === "facebook") {
    const publish = await fetch(
      `https://graph.facebook.com/v23.0/${post.external_account_id}/photos`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          url: mediaUrl,
          caption: post.caption || "",
          access_token: token,
        }),
      }
    );
    if (!publish.ok) throw new Error(`Facebook publishing failed: ${await publish.text()}`);
    raw = await publish.json<any>();
    providerPostId = (raw as any).post_id || (raw as any).id || null;
  } else if (post.platform === "linkedin") {
    const owner = `urn:li:person:${post.external_account_id}`;
    const init = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "LinkedIn-Version": "202610",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    });
    if (!init.ok) throw new Error(`LinkedIn upload initialization failed: ${await init.text()}`);
    const initPayload = await init.json<any>();
    const uploadUrl = initPayload.value?.uploadUrl;
    const imageUrn = initPayload.value?.image;
    const imageResponse = await fetch(mediaUrl);
    const imageBlob = await imageResponse.blob();
    const upload = await fetch(uploadUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": imageBlob.type || "image/jpeg" },
      body: imageBlob,
    });
    if (!upload.ok) throw new Error("LinkedIn image upload failed.");

    const publish = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "LinkedIn-Version": "202610",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: owner,
        commentary: post.caption || "",
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
    if (!publish.ok) throw new Error(`LinkedIn publishing failed: ${await publish.text()}`);
    raw = { id: publish.headers.get("x-restli-id") };
    providerPostId = (raw as any).id || null;
  } else if (post.platform === "tiktok") {
    const publish = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/content/init/",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title: (post.caption || post.title || "").slice(0, 2200),
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
      }
    );
    if (!publish.ok) throw new Error(`TikTok publishing failed: ${await publish.text()}`);
    raw = await publish.json<any>();
    providerPostId = (raw as any).data?.publish_id || null;
  } else {
    const imageResponse = await fetch(mediaUrl);
    const imageBlob = await imageResponse.blob();
    const form = new FormData();
    form.append("media", imageBlob, "brandsparq.jpg");
    form.append("media_category", "tweet_image");
    const media = await fetch("https://api.x.com/2/media/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    if (!media.ok) throw new Error(`X media upload failed: ${await media.text()}`);
    const mediaPayload = await media.json<any>();
    const mediaId = mediaPayload.data?.id || mediaPayload.media_id_string;
    const publish = await fetch("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: (post.caption || post.title || "").slice(0, 280),
        media: { media_ids: [mediaId] },
      }),
    });
    if (!publish.ok) throw new Error(`X publishing failed: ${await publish.text()}`);
    raw = await publish.json<any>();
    providerPostId = (raw as any).data?.id || null;
    if (providerPostId) providerPostUrl = `https://x.com/i/web/status/${providerPostId}`;
  }

  const receiptId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO social_publish_receipts
       (id, post_id, social_account_id, provider_post_id, provider_post_url, status, raw_json)
       VALUES (?, ?, ?, ?, ?, 'published', ?)`
    ).bind(
      receiptId,
      post.id,
      post.social_account_id,
      providerPostId,
      providerPostUrl,
      JSON.stringify(raw || {})
    ),
    env.DB.prepare(
      `UPDATE posts SET
       status = 'published', platform_post_id = ?, platform_url = ?,
       published_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      providerPostId,
      providerPostUrl,
      new Date().toISOString(),
      new Date().toISOString(),
      post.id
    ),
  ]);

  return { receiptId, providerPostId, providerPostUrl, raw };
}

export async function syncAccountAnalytics(env: SocialEnv, accountId: string) {
  const account = await env.DB.prepare(
    "SELECT * FROM social_accounts WHERE id = ?"
  ).bind(accountId).first<SocialAccountRow>();
  if (!account) throw new Error("Social account not found.");

  const runId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO analytics_sync_runs (id, social_account_id, status) VALUES (?, ?, 'running')"
  ).bind(runId, accountId).run();

  try {
    const posts = await env.DB.prepare(
      `SELECT id, platform_post_id FROM posts
       WHERE social_account_id = ? AND status = 'published' AND platform_post_id IS NOT NULL
       ORDER BY published_at DESC LIMIT 50`
    ).bind(accountId).all<{ id: string; platform_post_id: string }>();

    const token = await accountToken(env, account);

    for (const post of posts.results) {
      let metrics: any = {};
      if (account.platform === "x") {
        const result = await fetch(
          `https://api.x.com/2/tweets/${post.platform_post_id}?tweet.fields=public_metrics`,
          { headers: { authorization: `Bearer ${token}` } }
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
        const result = await fetch(
          `https://graph.facebook.com/v23.0/${post.platform_post_id}/insights?metric=impressions,reach,likes,comments,saved,shares&access_token=${encodeURIComponent(token)}`
        );
        if (result.ok) {
          const payload = await result.json<any>();
          const byName = Object.fromEntries((payload.data || []).map((m: any) => [m.name, m.values?.[0]?.value ?? m.total_value?.value]));
          metrics = {
            impressions: byName.impressions,
            reach: byName.reach,
            likes: byName.likes,
            comments: byName.comments,
            shares: byName.shares,
            saves: byName.saved,
            raw: payload,
          };
        }
      }

      await env.DB.prepare(
        `INSERT INTO post_metrics
         (id, post_id, platform, impressions, reach, likes, comments, shares, clicks, saves, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
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
        JSON.stringify(metrics.raw || { status: "not_available_for_provider" })
      ).run();
    }

    await env.DB.prepare(
      "UPDATE analytics_sync_runs SET status = 'completed', completed_at = ? WHERE id = ?"
    ).bind(new Date().toISOString(), runId).run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE analytics_sync_runs SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?"
    ).bind(
      new Date().toISOString(),
      error instanceof Error ? error.message.slice(0, 1000) : "Analytics sync failed",
      runId
    ).run();
    throw error;
  }

  return { runId };
}

export async function resolveDefaultSocialAccount(
  env: SocialEnv,
  clientId: string,
  platform: Platform
) {
  const preferred = await env.DB.prepare(
    `SELECT id, account_name
     FROM social_accounts
     WHERE client_id = ? AND platform = ? AND status = 'connected'
     ORDER BY is_default DESC, created_at ASC
     LIMIT 2`
  ).bind(clientId, platform).all<{ id: string; account_name: string | null }>();

  if (!preferred.results.length) return null;

  const explicitDefault = await env.DB.prepare(
    `SELECT id, account_name
     FROM social_accounts
     WHERE client_id = ? AND platform = ? AND status = 'connected' AND is_default = 1
     LIMIT 1`
  ).bind(clientId, platform).first<{ id: string; account_name: string | null }>();

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
  }
) {
  if (post.social_account_id) {
    const assigned = await env.DB.prepare(
      `SELECT id, account_name
       FROM social_accounts
       WHERE id = ? AND client_id = ? AND platform = ? AND status = 'connected'`
    ).bind(
      post.social_account_id,
      post.client_id,
      post.platform
    ).first<{ id: string; account_name: string | null }>();

    if (assigned) return assigned;
  }

  const fallback = await resolveDefaultSocialAccount(
    env,
    post.client_id,
    post.platform
  );
  if (!fallback) return null;

  await env.DB.prepare(
    "UPDATE posts SET social_account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(fallback.id, post.id).run();

  return fallback;
}

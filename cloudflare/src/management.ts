import type { SessionUser } from "./auth";
import { accessibleClientIds, hasClientAccess, hasPermission, type Permission } from "./authz";
import { deliverNotification } from "./notifications";
import { findNextAvailableSlot, validateSchedule } from "./scheduling";
import {
  socialOAuthCallback,
  socialOAuthStart,
  syncAccountAnalytics,
} from "./social";

export interface ManagementEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  SOCIAL_TOKEN_KEY?: string;
  AUTH_PEPPER?: string;
  PUBLIC_BASE_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_FROM_NAME?: string;
  REVIEW_BASE_URL?: string;
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

type User = SessionUser;

export type ManagementResult =
  | { body: unknown; status?: number }
  | { response: Response };

function json(value: string | null | undefined, fallback: unknown) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function authorize(
  env: ManagementEnv,
  user: User,
  permission: Permission,
  clientId?: string | null
) {
  if (!hasPermission(user, permission)) {
    return "You do not have permission to perform this action.";
  }
  if (clientId && !(await hasClientAccess(env.DB, user, clientId))) {
    return "You do not have access to this client.";
  }
  return null;
}

export async function handleManagementRoute(
  request: Request,
  url: URL,
  env: ManagementEnv,
  user: User
): Promise<ManagementResult | null> {
  if (request.method === "GET" && url.pathname === "/v1/campaigns") {
    const denied = await authorize(env, user, "read");
    if (denied) return { body: { error: denied }, status: 403 };

    const clientId = url.searchParams.get("clientId");
    if (clientId) {
      const clientDenied = await authorize(env, user, "read", clientId);
      if (clientDenied) return { body: { error: clientDenied }, status: 403 };
    }

    const allowedClients = await accessibleClientIds(env.DB, user);
    const rows = clientId
      ? await env.DB.prepare(
          `SELECT c.*,
             COUNT(p.id) AS post_count,
             SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END) AS published_count,
             SUM(CASE WHEN p.status = 'awaiting_approval' THEN 1 ELSE 0 END) AS review_count
           FROM campaigns c
           LEFT JOIN posts p ON p.campaign_id = c.id
           WHERE c.client_id = ?
           GROUP BY c.id ORDER BY c.created_at DESC`
        ).bind(clientId).all()
      : await env.DB.prepare(
          `SELECT c.*,
             cl.name AS client_name,
             COUNT(p.id) AS post_count,
             SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END) AS published_count,
             SUM(CASE WHEN p.status = 'awaiting_approval' THEN 1 ELSE 0 END) AS review_count
           FROM campaigns c
           JOIN clients cl ON cl.id = c.client_id
           LEFT JOIN posts p ON p.campaign_id = c.id
           GROUP BY c.id ORDER BY c.created_at DESC`
        ).all();
    const visible = allowedClients === null || clientId
      ? rows.results
      : rows.results.filter((row: any) => allowedClients.includes(row.client_id));
    return { body: { data: visible } };
  }

  const campaignMatch = url.pathname.match(/^\/v1\/campaigns\/([^/]+)$/);
  if (campaignMatch && request.method === "GET") {
    const campaign = await env.DB.prepare(
      `SELECT c.*, cl.name AS client_name FROM campaigns c
       JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?`
    ).bind(campaignMatch[1]).first();
    if (!campaign) return { body: { error: "Campaign not found." }, status: 404 };
    const denied = await authorize(env, user, "read", (campaign as any).client_id);
    if (denied) return { body: { error: denied }, status: 403 };

    const posts = await env.DB.prepare(
      `SELECT p.*, sa.account_name AS social_account_name
       FROM posts p
       LEFT JOIN social_accounts sa ON sa.id = p.social_account_id
       WHERE p.campaign_id = ? ORDER BY COALESCE(p.scheduled_publish_at,p.suggested_publish_at,p.created_at)`
    ).bind(campaignMatch[1]).all();
    return { body: { data: { campaign, posts: posts.results } } };
  }

  if (campaignMatch && request.method === "POST") {
    const campaign = await env.DB.prepare(
      "SELECT client_id FROM campaigns WHERE id = ?"
    ).bind(campaignMatch[1]).first<{ client_id: string }>();
    if (!campaign) return { body: { error: "Campaign not found." }, status: 404 };

    const denied = await authorize(env, user, "client_manage", campaign.client_id);
    if (denied) return { body: { error: denied }, status: 403 };

    const payload = await request.json<any>().catch(() => ({} as any));
    await env.DB.prepare(
      `UPDATE campaigns SET
       name = COALESCE(?, name),
       objective = COALESCE(?, objective),
       status = COALESCE(?, status),
       starts_at = ?,
       ends_at = ?,
       priority = COALESCE(?, priority),
       notes = ?,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      payload.name || null,
      payload.objective || null,
      payload.status || null,
      payload.startsAt || null,
      payload.endsAt || null,
      payload.priority ?? null,
      payload.notes || null,
      campaignMatch[1]
    ).run();
    return { body: { ok: true } };
  }

  if (request.method === "GET" && url.pathname === "/v1/social/accounts") {
    const denied = await authorize(env, user, "read");
    if (denied) return { body: { error: denied }, status: 403 };

    const clientId = url.searchParams.get("clientId");
    if (clientId) {
      const clientDenied = await authorize(env, user, "read", clientId);
      if (clientDenied) return { body: { error: clientDenied }, status: 403 };
    }
    const allowedClients = await accessibleClientIds(env.DB, user);
    const query = `SELECT id, client_id, platform, account_name, external_account_id,
       status, token_expires_at, scopes, account_type, last_verified_at, last_error,
       health_status, health_checked_at, permission_status, rate_limit_reset_at,
       is_default, created_at, updated_at FROM social_accounts`;
    const rows = clientId
      ? await env.DB.prepare(`${query} WHERE client_id = ? ORDER BY platform, account_name`).bind(clientId).all()
      : await env.DB.prepare(`${query} ORDER BY client_id, platform, account_name`).all();
    const visible = allowedClients === null || clientId
      ? rows.results
      : rows.results.filter((row: any) => allowedClients.includes(row.client_id));
    return { body: { data: visible } };
  }

  if (request.method === "GET" && url.pathname === "/v1/social/connect") {
    const platform = url.searchParams.get("platform") as any;
    const clientId = url.searchParams.get("clientId") || "";
    const returnTo = url.searchParams.get("returnTo") || `${url.origin}/social`;
    if (!["facebook","instagram","linkedin","tiktok","x"].includes(platform) || !clientId) {
      return { body: { error: "platform and clientId are required." }, status: 400 };
    }

    const denied = await authorize(env, user, "social_manage", clientId);
    if (denied) return { body: { error: denied }, status: 403 };

    const start = await socialOAuthStart(env, url, platform, clientId, user.id, returnTo);
    return { response: Response.redirect(start, 302) };
  }

  const callbackMatch = url.pathname.match(/^\/v1\/social\/(meta|linkedin|tiktok|x)\/callback$/);
  if (request.method === "GET" && callbackMatch) {
    try {
      const destination = await socialOAuthCallback(env, url, callbackMatch[1] as any);
      return { response: Response.redirect(destination, 302) };
    } catch (error) {
      return {
        body: { error: error instanceof Error ? error.message : "Social connection failed." },
        status: 400,
      };
    }
  }

  const verifyMatch = url.pathname.match(/^\/v1\/social\/accounts\/([^/]+)\/verify$/);
  if (verifyMatch && request.method === "POST") {
    const account = await env.DB.prepare(
      "SELECT client_id FROM social_accounts WHERE id = ?"
    ).bind(verifyMatch[1]).first<{ client_id: string }>();
    if (!account) return { body: { error: "Social account not found." }, status: 404 };

    const denied = await authorize(env, user, "social_manage", account.client_id);
    if (denied) return { body: { error: denied }, status: 403 };

    try {
      const result = await verifySocialAccount(env, verifyMatch[1]);
      return { body: { ok: true, data: result } };
    } catch (error) {
      return {
        body: { error: error instanceof Error ? error.message : "Verification failed." },
        status: 409,
      };
    }
  }

  const disconnectMatch = url.pathname.match(/^\/v1\/social\/accounts\/([^/]+)\/disconnect$/);
  if (disconnectMatch && request.method === "POST") {
    const account = await env.DB.prepare(
      "SELECT client_id FROM social_accounts WHERE id = ?"
    ).bind(disconnectMatch[1]).first<{ client_id: string }>();
    if (!account) return { body: { error: "Social account not found." }, status: 404 };

    const denied = await authorize(env, user, "social_manage", account.client_id);
    if (denied) return { body: { error: denied }, status: 403 };

    await env.DB.prepare(
      `UPDATE social_accounts SET
       status = 'disconnected',
       health_status = 'disconnected',
       permission_status = 'disconnected',
       access_token_ciphertext = NULL,
       refresh_token_ciphertext = NULL,
       last_error = NULL,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(disconnectMatch[1]).run();
    return { body: { ok: true } };
  }

  const assignMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/social-account$/);
  if (assignMatch && request.method === "POST") {
    const post = await env.DB.prepare(
      "SELECT client_id FROM posts WHERE id = ?"
    ).bind(assignMatch[1]).first<{ client_id: string }>();
    if (!post) return { body: { error: "Post not found." }, status: 404 };

    const denied = await authorize(env, user, "review", post.client_id);
    if (denied) return { body: { error: denied }, status: 403 };

    const payload = await request.json<{ socialAccountId?: string }>().catch(() => ({} as any));
    if (!payload.socialAccountId) return { body: { error: "socialAccountId is required." }, status: 400 };
    const account = await env.DB.prepare(
      `SELECT sa.id FROM social_accounts sa
       JOIN posts p ON p.id = ?
       WHERE sa.id = ? AND sa.client_id = p.client_id AND sa.platform = p.platform AND sa.status = 'connected'`
    ).bind(assignMatch[1], payload.socialAccountId).first();
    if (!account) return { body: { error: "That social account cannot publish this post." }, status: 409 };
    await env.DB.prepare(
      "UPDATE posts SET social_account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(payload.socialAccountId, assignMatch[1]).run();
    return { body: { ok: true } };
  }

  if (request.method === "GET" && url.pathname === "/v1/notifications") {
    const denied = await authorize(env, user, "read");
    if (denied) return { body: { error: denied }, status: 403 };

    const rows = await env.DB.prepare(
      `SELECT * FROM notifications
       WHERE user_id = ? OR user_id IS NULL
       ORDER BY created_at DESC LIMIT 100`
    ).bind(user.id).all();
    return { body: { data: rows.results } };
  }

  if (request.method === "POST" && url.pathname === "/v1/push-token") {
    const payload = await request.json<any>().catch(() => ({} as any));
    if (!payload.token) return { body: { error: "token is required." }, status: 400 };
    await env.DB.prepare(
      `INSERT INTO device_push_tokens
       (id, user_id, expo_push_token, platform, device_name)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(expo_push_token) DO UPDATE SET
         user_id = excluded.user_id, enabled = 1, platform = excluded.platform,
         device_name = excluded.device_name, updated_at = CURRENT_TIMESTAMP`
    ).bind(
      crypto.randomUUID(),
      user.id,
      payload.token,
      payload.platform || null,
      payload.deviceName || null
    ).run();
    return { body: { ok: true } };
  }

  if (request.method === "GET" && url.pathname === "/v1/settings") {
    const denied = await authorize(env, user, "read");
    if (denied) return { body: { error: denied }, status: 403 };

    const workspace = await env.DB.prepare(
      "SELECT * FROM workspace_settings WHERE id = 'default'"
    ).first<any>();
    const preferences = await env.DB.prepare(
      "SELECT * FROM notification_preferences WHERE user_id = ?"
    ).bind(user.id).first<any>();
    return {
      body: {
        data: {
          workspace: {
            ...workspace,
            preferred_windows: json(workspace?.preferred_windows, []),
            blackout_windows: json(workspace?.blackout_windows, []),
          },
          notifications: preferences || {
            email_enabled: 1,
            push_enabled: 1,
            in_app_enabled: 1,
            review_email_enabled: 1,
            prepublish_minutes: workspace?.default_prepublish_minutes || 30,
            no_response_policy: workspace?.default_no_response_policy || "auto_publish",
          },
        },
      },
    };
  }

  if (request.method === "POST" && url.pathname === "/v1/settings") {
    const denied = await authorize(env, user, "settings_manage");
    if (denied) return { body: { error: denied }, status: 403 };

    const payload = await request.json<any>().catch(() => ({} as any));
    const w = payload.workspace || {};
    const n = payload.notifications || {};

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE workspace_settings SET
         timezone = COALESCE(?, timezone),
         default_prepublish_minutes = COALESCE(?, default_prepublish_minutes),
         default_no_response_policy = COALESCE(?, default_no_response_policy),
         min_post_spacing_minutes = COALESCE(?, min_post_spacing_minutes),
         max_posts_per_day = COALESCE(?, max_posts_per_day),
         preferred_windows = COALESCE(?, preferred_windows),
         blackout_windows = COALESCE(?, blackout_windows),
         analytics_refresh_hours = COALESCE(?, analytics_refresh_hours),
         updated_at = CURRENT_TIMESTAMP
         WHERE id = 'default'`
      ).bind(
        w.timezone || null,
        w.defaultPrepublishMinutes ?? null,
        w.defaultNoResponsePolicy || null,
        w.minPostSpacingMinutes ?? null,
        w.maxPostsPerDay ?? null,
        w.preferredWindows ? JSON.stringify(w.preferredWindows) : null,
        w.blackoutWindows ? JSON.stringify(w.blackoutWindows) : null,
        w.analyticsRefreshHours ?? null
      ),
      env.DB.prepare(
        `INSERT INTO notification_preferences
         (user_id, email_enabled, push_enabled, in_app_enabled, review_email_enabled,
          prepublish_minutes, no_response_policy)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           email_enabled = excluded.email_enabled,
           push_enabled = excluded.push_enabled,
           in_app_enabled = excluded.in_app_enabled,
           review_email_enabled = excluded.review_email_enabled,
           prepublish_minutes = excluded.prepublish_minutes,
           no_response_policy = excluded.no_response_policy,
           updated_at = CURRENT_TIMESTAMP`
      ).bind(
        user.id,
        n.emailEnabled === false ? 0 : 1,
        n.pushEnabled === false ? 0 : 1,
        n.inAppEnabled === false ? 0 : 1,
        n.reviewEmailEnabled === false ? 0 : 1,
        n.prepublishMinutes ?? w.defaultPrepublishMinutes ?? 30,
        n.noResponsePolicy || w.defaultNoResponsePolicy || "auto_publish"
      ),
    ]);
    return { body: { ok: true } };
  }

  if (request.method === "GET" && url.pathname === "/v1/analytics/overview") {
    const denied = await authorize(env, user, "read");
    if (denied) return { body: { error: denied }, status: 403 };

    const clientId = url.searchParams.get("clientId");
    if (clientId) {
      const clientDenied = await authorize(env, user, "read", clientId);
      if (clientDenied) return { body: { error: clientDenied }, status: 403 };
    }

    const allowedClients = await accessibleClientIds(env.DB, user);
    if (!clientId && allowedClients !== null && allowedClients.length === 0) {
      return {
        body: {
          data: {
            overview: {
              posts: 0, impressions: 0, reach: 0, likes: 0,
              comments: 0, shares: 0, clicks: 0, saves: 0,
            },
            byPlatform: [],
          },
        },
      };
    }

    let filter = "";
    let bindings: string[] = [];
    if (clientId) {
      filter = "WHERE p.client_id = ?";
      bindings = [clientId];
    } else if (allowedClients !== null) {
      filter = `WHERE p.client_id IN (${allowedClients.map(() => "?").join(",")})`;
      bindings = allowedClients;
    }

    const overviewStatement = env.DB.prepare(
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
       LEFT JOIN (
         SELECT m1.* FROM post_metrics m1
         JOIN (
           SELECT post_id, MAX(measured_at) AS measured_at
           FROM post_metrics GROUP BY post_id
         ) latest ON latest.post_id = m1.post_id AND latest.measured_at = m1.measured_at
       ) pm ON pm.post_id = p.id
       ${filter}`
    );
    const overview = bindings.length
      ? await overviewStatement.bind(...bindings).first()
      : await overviewStatement.first();

    let platformQuery = "SELECT platform, COUNT(*) AS posts FROM posts WHERE status = 'published'";
    if (clientId) {
      platformQuery += " AND client_id = ? GROUP BY platform";
    } else if (allowedClients !== null) {
      platformQuery += ` AND client_id IN (${allowedClients.map(() => "?").join(",")}) GROUP BY platform`;
    } else {
      platformQuery += " GROUP BY platform";
    }

    const platformStatement = env.DB.prepare(platformQuery);
    const byPlatform = bindings.length
      ? await platformStatement.bind(...bindings).all()
      : await platformStatement.all();

    return { body: { data: { overview, byPlatform: byPlatform.results } } };
  }

  if (request.method === "POST" && url.pathname === "/v1/analytics/sync") {
    const denied = await authorize(env, user, "analytics_manage");
    if (denied) return { body: { error: denied }, status: 403 };

    const payload = await request.json<{ accountId?: string }>().catch(() => ({} as any));
    if (payload.accountId) {
      await syncAccountAnalytics(env, payload.accountId);
    } else {
      const accounts = await env.DB.prepare(
        "SELECT id FROM social_accounts WHERE status = 'connected'"
      ).all<{ id: string }>();
      for (const account of accounts.results) {
        try { await syncAccountAnalytics(env, account.id); } catch {}
      }
    }
    return { body: { ok: true } };
  }

  const validateMatch = url.pathname.match(/^\/v1\/clients\/([^/]+)\/schedule\/validate$/);
  if (validateMatch && request.method === "POST") {
    const denied = await authorize(env, user, "calendar_manage", validateMatch[1]);
    if (denied) return { body: { error: denied }, status: 403 };

    const payload = await request.json<{ scheduledAt?: string }>().catch(() => ({} as any));
    if (!payload.scheduledAt) return { body: { error: "scheduledAt is required." }, status: 400 };
    return { body: { data: await validateSchedule(env, validateMatch[1], payload.scheduledAt) } };
  }

  const recommendMatch = url.pathname.match(/^\/v1\/clients\/([^/]+)\/schedule\/recommend$/);
  if (recommendMatch && request.method === "POST") {
    const denied = await authorize(env, user, "calendar_manage", recommendMatch[1]);
    if (denied) return { body: { error: denied }, status: 403 };

    const payload = await request.json<{ desiredAt?: string }>().catch(() => ({} as any));
    return { body: { data: { scheduledAt: await findNextAvailableSlot(env, recommendMatch[1], payload.desiredAt) } } };
  }

  if (request.method === "POST" && url.pathname === "/v1/notifications/test") {
    const denied = await authorize(env, user, "notifications_manage");
    if (denied) return { body: { error: denied }, status: 403 };

    await deliverNotification(env, {
      userId: user.id,
      type: "test",
      title: "BrandSparQ notifications are working",
      body: "This is a test notification from your BrandSparQ workspace.",
      deepLink: env.PUBLIC_BASE_URL || undefined,
    });
    return { body: { ok: true } };
  }

  return null;
}

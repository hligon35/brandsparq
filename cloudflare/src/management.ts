import { enqueueAnalytics } from "./analytics-jobs";
import { validRevision, revisionRequired, revisionConflict } from "./revisions";
import { pageOptions, pageResult } from "./pagination";
import { latestMetricsJoin } from "./analytics";
import { campaignBoundary, validCampaignDate } from "./campaign-workflow";
import { validateSettings } from "./settings-validation";
import { handleProfile } from "./profile";
import type { SessionUser } from "./auth";
import {
  accessibleClientIds,
  hasClientAccess,
  hasClientPermission,
  hasPermission,
  type Permission,
} from "./authz";
import { deliverNotification } from "./notifications";
import { findNextAvailableSlot, validateSchedule } from "./scheduling";
import { socialOAuthCallback, socialOAuthStart, verifySocialAccount } from "./social";

export interface ManagementEnv {
  DB: D1Database;
  GENERATION_QUEUE?: Queue<any>;
  ENVIRONMENT?: string;
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

export type ManagementResult = { body: unknown; status?: number } | { response: Response };

function json(value: string | null | undefined, fallback: unknown) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function authorize(
  env: ManagementEnv,
  user: User,
  permission: Permission,
  clientId?: string | null,
  requireActive = true,
) {
  if (
    !(clientId
      ? await hasClientPermission(env.DB, user, permission, clientId)
      : hasPermission(user, permission))
  ) {
    return "You do not have permission to perform this action.";
  }
  if (clientId && !(await hasClientAccess(env.DB, user, clientId))) {
    return "You do not have access to this client.";
  }
  if (clientId && permission !== "read" && requireActive) {
    const client = await env.DB.prepare("SELECT status FROM clients WHERE id=?")
      .bind(clientId)
      .first<{ status: string }>();
    if (!client || client.status !== "active") return "This client is archived or unavailable.";
  }
  return null;
}

export async function handleManagementRoute(
  request: Request,
  url: URL,
  env: ManagementEnv,
  user: User,
): Promise<ManagementResult | null> {
  const profileResult = await handleProfile(request, url, env, user);
  if (profileResult) return profileResult;
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
           GROUP BY c.id ORDER BY c.priority DESC,c.created_at DESC`,
        )
          .bind(clientId)
          .all()
      : await env.DB.prepare(
          `SELECT c.*,
             cl.name AS client_name,
             COUNT(p.id) AS post_count,
             SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END) AS published_count,
             SUM(CASE WHEN p.status = 'awaiting_approval' THEN 1 ELSE 0 END) AS review_count
           FROM campaigns c
           JOIN clients cl ON cl.id = c.client_id
           LEFT JOIN posts p ON p.campaign_id = c.id
           GROUP BY c.id ORDER BY c.priority DESC,c.created_at DESC`,
        ).all();
    const visible =
      allowedClients === null || clientId
        ? rows.results
        : rows.results.filter((row: any) => allowedClients.includes(row.client_id));
    return { body: { data: visible } };
  }

  const campaignMatch = url.pathname.match(/^\/v1\/campaigns\/([^/]+)$/);
  if (campaignMatch && request.method === "GET") {
    const campaign = await env.DB.prepare(
      `SELECT c.*, cl.name AS client_name FROM campaigns c
       JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?`,
    )
      .bind(campaignMatch[1])
      .first();
    if (!campaign) return { body: { error: "Campaign not found." }, status: 404 };
    const denied = await authorize(env, user, "read", (campaign as any).client_id);
    if (denied) return { body: { error: denied }, status: 403 };

    const posts = await env.DB.prepare(
      `SELECT p.*, sa.account_name AS social_account_name
       FROM posts p
       LEFT JOIN social_accounts sa ON sa.id = p.social_account_id
       WHERE p.campaign_id = ? ORDER BY COALESCE(p.scheduled_publish_at,p.suggested_publish_at,p.created_at)`,
    )
      .bind(campaignMatch[1])
      .all();
    return { body: { data: { campaign, posts: posts.results } } };
  }

  if (campaignMatch && request.method === "POST") {
    const campaign = await env.DB.prepare(
      "SELECT c.*,cl.timezone FROM campaigns c JOIN clients cl ON cl.id=c.client_id WHERE c.id = ?",
    )
      .bind(campaignMatch[1])
      .first<any>();
    if (!campaign) return { body: { error: "Campaign not found." }, status: 404 };

    const denied = await authorize(env, user, "client_manage", campaign.client_id);
    if (denied) return { body: { error: denied }, status: 403 };

    const payload = await request.json<any>().catch(() => ({}) as any);
    const name =
      payload.name === undefined
        ? campaign.name
        : typeof payload.name === "string"
          ? payload.name.trim()
          : "";
    const status = payload.status === undefined ? campaign.status : payload.status;
    const priority =
      payload.priority === undefined ? Number(campaign.priority || 0) : Number(payload.priority);
    const start = payload.startsAt === undefined ? campaign.starts_at : payload.startsAt || null;
    const end = payload.endsAt === undefined ? campaign.ends_at : payload.endsAt || null;
    if (
      !name ||
      name.length > 200 ||
      !["draft", "active", "paused", "completed", "archived"].includes(status) ||
      !Number.isInteger(priority) ||
      priority < 0 ||
      priority > 100 ||
      (start && !validCampaignDate(start)) ||
      (end && !validCampaignDate(end)) ||
      (start &&
        end &&
        campaignBoundary(end, campaign.timezone, true)! <=
          campaignBoundary(start, campaign.timezone)!)
    )
      return {
        body: { error: "Check the campaign name, status, priority (0–100), and start/end dates." },
        status: 400,
      };
    if (
      (payload.notes !== undefined && typeof payload.notes !== "string") ||
      (payload.objective !== undefined && typeof payload.objective !== "string")
    )
      return { body: { error: "Objective and notes must be text." }, status: 400 };
    if (!validRevision(payload.expectedRevision)) return revisionRequired;
    const editToken = crypto.randomUUID();
    const [updated] = await env.DB.batch([
      env.DB.prepare(
        "UPDATE campaigns SET edit_token=?,name=?,objective=?,status=?,starts_at=?,ends_at=?,priority=?,notes=?,workflow_revision=workflow_revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workflow_revision=?",
      ).bind(
        editToken,
        name,
        (payload.objective ?? campaign.objective ?? "").slice(0, 2000),
        status,
        start,
        end,
        priority,
        (payload.notes ?? campaign.notes ?? "").slice(0, 10000),
        campaignMatch[1],
        payload.expectedRevision,
      ),
      env.DB.prepare(
        "UPDATE clients SET schedule_revision=schedule_revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM campaigns WHERE id=? AND edit_token=?)",
      ).bind(campaign.client_id, campaignMatch[1], editToken),
    ]);
    if (!updated.meta.changes)
      return {
        body: { error: "Campaign changed while saving. Reload before editing again." },
        status: 409,
      };
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
      ? await env.DB.prepare(`${query} WHERE client_id = ? ORDER BY platform, account_name`)
          .bind(clientId)
          .all()
      : await env.DB.prepare(`${query} ORDER BY client_id, platform, account_name`).all();
    const visible =
      allowedClients === null || clientId
        ? rows.results
        : rows.results.filter((row: any) => allowedClients.includes(row.client_id));
    return { body: { data: visible } };
  }

  if (request.method === "POST" && url.pathname === "/v1/social/connect") {
    const payload = await request.json<any>().catch(() => ({}));
    const platform = payload.platform;
    const clientId = typeof payload.clientId === "string" ? payload.clientId : "";
    const importClients = payload.importClients === true;
    const returnTo =
      typeof payload.returnTo === "string" ? payload.returnTo : `${url.origin}/social`;
    if (
      !["facebook", "instagram", "linkedin", "tiktok", "x"].includes(platform) ||
      (!clientId && !importClients)
    ) {
      return { body: { error: "platform and clientId are required." }, status: 400 };
    }

    const denied = importClients
      ? user.role !== "owner"
        ? "Only a workspace owner can import clients from Meta."
        : null
      : await authorize(env, user, "social_manage", clientId);
    if (denied) return { body: { error: denied }, status: 403 };

    try {
      const start = await socialOAuthStart(
        env,
        url,
        platform,
        clientId,
        user.id,
        returnTo,
        importClients,
      );
      return { body: { authorizationUrl: start } };
    } catch (error) {
      return {
        body: {
          error: error instanceof Error ? error.message : "Unable to start social authorization.",
        },
        status: 400,
      };
    }
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

  const defaultMatch = url.pathname.match(/^\/v1\/social\/accounts\/([^/]+)\/default$/);
  if (defaultMatch && request.method === "POST") {
    const account = await env.DB.prepare("SELECT * FROM social_accounts WHERE id=?")
      .bind(defaultMatch[1])
      .first<any>();
    if (!account) return { body: { error: "Social account not found." }, status: 404 };
    const denied = await authorize(env, user, "social_manage", account.client_id);
    if (denied) return { body: { error: denied }, status: 403 };
    const result =
      await env.DB.prepare(`UPDATE social_accounts SET is_default=CASE WHEN id=? THEN 1 ELSE 0 END,updated_at=CURRENT_TIMESTAMP
      WHERE client_id=? AND platform=? AND EXISTS(SELECT 1 FROM social_accounts chosen WHERE chosen.id=? AND chosen.status='connected'
        AND COALESCE(chosen.health_status,'healthy') NOT IN ('reauth_required','disconnected','degraded')
        AND (chosen.token_expires_at IS NULL OR chosen.token_expires_at>?))`)
        .bind(account.id, account.client_id, account.platform, account.id, Date.now())
        .run();
    return result.meta.changes
      ? { body: { ok: true } }
      : {
          body: { error: "Reconnect or verify this account before making it the default." },
          status: 409,
        };
  }

  const verifyMatch = url.pathname.match(/^\/v1\/social\/accounts\/([^/]+)\/verify$/);
  if (verifyMatch && request.method === "POST") {
    const account = await env.DB.prepare("SELECT client_id FROM social_accounts WHERE id = ?")
      .bind(verifyMatch[1])
      .first<{ client_id: string }>();
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
    const account = await env.DB.prepare("SELECT client_id FROM social_accounts WHERE id = ?")
      .bind(disconnectMatch[1])
      .first<{ client_id: string }>();
    if (!account) return { body: { error: "Social account not found." }, status: 404 };

    const denied = await authorize(env, user, "social_manage", account.client_id, false);
    if (denied) return { body: { error: denied }, status: 403 };

    await env.DB.prepare(
      `UPDATE social_accounts SET
       connection_revision=connection_revision+1,refresh_claim=NULL,refresh_until=NULL,
       status = 'disconnected',
       health_status = 'disconnected',
       permission_status = 'disconnected',
       access_token_ciphertext = NULL,
       refresh_token_ciphertext = NULL,
       last_error = NULL,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(disconnectMatch[1])
      .run();
    return { body: { ok: true } };
  }

  const assignMatch = url.pathname.match(/^\/v1\/posts\/([^/]+)\/social-account$/);
  if (assignMatch && request.method === "POST") {
    const post = await env.DB.prepare("SELECT client_id,status FROM posts WHERE id = ?")
      .bind(assignMatch[1])
      .first<{ client_id: string; status: string }>();
    if (!post) return { body: { error: "Post not found." }, status: 404 };

    const denied = await authorize(env, user, "review", post.client_id);
    if (denied) return { body: { error: denied }, status: 403 };

    if (!["awaiting_approval", "edit_requested"].includes(post.status))
      return {
        body: { error: "Change destinations only while a post is in review." },
        status: 409,
      };
    const payload = await request
      .json<{ socialAccountId?: string; expectedRevision?: number }>()
      .catch(() => ({}) as any);
    if (!payload.socialAccountId)
      return { body: { error: "socialAccountId is required." }, status: 400 };
    const account = await env.DB.prepare(
      `SELECT sa.id FROM social_accounts sa
       JOIN posts p ON p.id = ?
       WHERE sa.id = ? AND sa.client_id = p.client_id AND sa.platform = p.platform AND sa.status = 'connected'`,
    )
      .bind(assignMatch[1], payload.socialAccountId)
      .first();
    if (!account)
      return { body: { error: "That social account cannot publish this post." }, status: 409 };
    if (!validRevision(payload.expectedRevision)) return revisionRequired;
    const changed =
      await env.DB.prepare(`UPDATE posts SET social_account_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status IN ('awaiting_approval','edit_requested') AND approved_at IS NULL AND content_revision=?
      AND EXISTS(SELECT 1 FROM clients WHERE id=posts.client_id AND status='active')
      AND EXISTS(SELECT 1 FROM social_accounts sa WHERE sa.id=? AND sa.client_id=posts.client_id AND sa.platform=posts.platform
        AND sa.status='connected' AND sa.access_token_ciphertext IS NOT NULL
        AND COALESCE(sa.health_status,'healthy') NOT IN ('reauth_required','degraded','disconnected')
        AND (sa.token_expires_at IS NULL OR sa.token_expires_at>?))`)
        .bind(
          payload.socialAccountId,
          assignMatch[1],
          payload.expectedRevision,
          payload.socialAccountId,
          Date.now(),
        )
        .run();
    if (!changed.meta.changes) return revisionConflict;

    return { body: { ok: true } };
  }

  // Historical notices must also respect assignments that have since been revoked.
  const notificationScope = `(n.user_id=? OR n.user_id IS NULL) AND
    (n.post_id IS NULL OR EXISTS (SELECT 1 FROM posts p WHERE p.id=n.post_id AND
      (?='owner' OR EXISTS (SELECT 1 FROM user_client_access a WHERE a.client_id=p.client_id AND a.user_id=?))))`;
  const notificationBindings = [user.id, user.role, user.id];

  if (request.method === "POST" && url.pathname === "/v1/notifications/delete") {
    const denied = await authorize(env, user, "read");
    if (denied) return { body: { error: denied }, status: 403 };
    const payload = await request.json<any>().catch(() => ({}));
    if (
      !Array.isArray(payload.ids) ||
      !payload.ids.length ||
      payload.ids.length > 100 ||
      payload.ids.some((id: unknown) => typeof id !== "string" || !id || id.length > 128)
    )
      return { body: { error: "Select between 1 and 100 notifications." }, status: 400 };
    const ids = [...new Set<string>(payload.ids)];
    await env.DB.batch(
      ids.map((id) =>
        env.DB.prepare(`INSERT INTO notification_inbox(user_id,notification_id,dismissed_at)
      SELECT ?,n.id,CURRENT_TIMESTAMP FROM notifications n WHERE n.id=? AND ${notificationScope}
      ON CONFLICT(user_id,notification_id) DO UPDATE SET dismissed_at=CURRENT_TIMESTAMP`).bind(
          user.id,
          id,
          ...notificationBindings,
        ),
      ),
    );
    return { body: { ok: true } };
  }

  if (request.method === "GET" && url.pathname === "/v1/notifications") {
    const denied = await authorize(env, user, "read");
    if (denied) return { body: { error: denied }, status: 403 };

    let page;
    try {
      page = pageOptions(url, 100);
    } catch (e) {
      return { body: { error: (e as Error).message }, status: 400 };
    }
    const filter = url.searchParams.get("filter") || "all";
    if (!["all", "unread", "failed"].includes(filter))
      return { body: { error: "Invalid notification filter." }, status: 400 };
    const inboxScope = `${notificationScope} AND NOT EXISTS (SELECT 1 FROM notification_inbox i WHERE i.notification_id=n.id AND i.user_id=? AND i.dismissed_at IS NOT NULL)`;
    const unread =
      (
        await env.DB.prepare(`SELECT COUNT(*) AS count FROM notifications n WHERE ${inboxScope}
      AND n.read_at IS NULL AND NOT EXISTS(SELECT 1 FROM notification_inbox i WHERE i.notification_id=n.id AND i.user_id=? AND i.read_at IS NOT NULL)`)
          .bind(...notificationBindings, user.id, user.id)
          .first<any>()
      )?.count || 0;
    const rows =
      await env.DB.prepare(`SELECT n.*, (SELECT i.read_at FROM notification_inbox i WHERE i.notification_id=n.id AND i.user_id=?) AS user_read_at
      FROM notifications n WHERE ${inboxScope}
      AND (?='all' OR (?='failed' AND n.status IN ('failed','partial')) OR (?='unread' AND n.read_at IS NULL AND NOT EXISTS(SELECT 1 FROM notification_inbox i WHERE i.notification_id=n.id AND i.user_id=? AND i.read_at IS NOT NULL)))
      AND (?='' OR instr(lower(COALESCE(n.title,'') || ' ' || COALESCE(n.body,'') || ' ' || n.type),lower(?))>0)
      AND (? IS NULL OR n.created_at<? OR (n.created_at=? AND n.id<?))
      ORDER BY n.created_at DESC,n.id DESC LIMIT ?`)
        .bind(
          user.id,
          ...notificationBindings,
          user.id,
          filter,
          filter,
          filter,
          user.id,
          page.search,
          page.search,
          page.cursor?.createdAt || null,
          page.cursor?.createdAt || null,
          page.cursor?.createdAt || null,
          page.cursor?.id || null,
          page.limit + 1,
        )
        .all<any>();
    const result = pageResult(rows.results, page.limit);
    rows.results = result.data;

    const ids = rows.results.map((row: any) => row.id);
    let deliveries: any[] = [];
    if (ids.length) {
      deliveries = (
        await env.DB.prepare(
          `SELECT notification_id,channel,destination,status,provider_message_id,error_message,sent_at,created_at
         FROM notification_deliveries
         WHERE notification_id IN (${ids.map(() => "?").join(",")})
         ORDER BY created_at ASC`,
        )
          .bind(...ids)
          .all<any>()
      ).results;
    }

    const byNotification = new Map<string, any[]>();
    for (const delivery of deliveries) {
      const current = byNotification.get(delivery.notification_id) || [];
      current.push(delivery);
      byNotification.set(delivery.notification_id, current);
    }

    const data = rows.results.map((row: any) => ({
      ...row,
      read_at: row.user_read_at || row.read_at,
      deliveries: byNotification.get(row.id) || [],
    }));
    return { body: { data, unreadCount: unread, nextCursor: result.nextCursor } };
  }

  const readNotificationMatch = url.pathname.match(/^\/v1\/notifications\/([^/]+)\/read$/);
  if (readNotificationMatch && request.method === "POST") {
    const denied = await authorize(env, user, "read");
    if (denied) return { body: { error: denied }, status: 403 };

    await env.DB.prepare(
      `INSERT INTO notification_inbox(user_id,notification_id,read_at) SELECT ?,n.id,CURRENT_TIMESTAMP FROM notifications n WHERE n.id=? AND ${notificationScope} ON CONFLICT(user_id,notification_id) DO UPDATE SET read_at=COALESCE(notification_inbox.read_at,CURRENT_TIMESTAMP)`,
    )
      .bind(user.id, readNotificationMatch[1], ...notificationBindings)
      .run();
    return { body: { ok: true } };
  }

  if (request.method === "POST" && url.pathname === "/v1/notifications/read-all") {
    const denied = await authorize(env, user, "read");
    if (denied) return { body: { error: denied }, status: 403 };

    await env.DB.prepare(
      `INSERT INTO notification_inbox(user_id,notification_id,read_at) SELECT ?,n.id,CURRENT_TIMESTAMP FROM notifications n WHERE ${notificationScope} ON CONFLICT(user_id,notification_id) DO UPDATE SET read_at=COALESCE(notification_inbox.read_at,CURRENT_TIMESTAMP)`,
    )
      .bind(user.id, ...notificationBindings)
      .run();
    return { body: { ok: true } };
  }

  if (request.method === "POST" && url.pathname === "/v1/push-token/unregister") {
    const payload = await request.json<any>().catch(() => ({}));
    if (typeof payload.token !== "string")
      return { body: { error: "Device token is required." }, status: 400 };
    await env.DB.prepare(
      "UPDATE device_push_tokens SET enabled=0,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND expo_push_token=?",
    )
      .bind(user.id, payload.token)
      .run();
    return { body: { ok: true } };
  }

  if (request.method === "POST" && url.pathname === "/v1/push-token") {
    const payload = await request.json<any>().catch(() => ({}) as any);
    if (!payload.token) return { body: { error: "token is required." }, status: 400 };
    await env.DB.prepare(
      `INSERT INTO device_push_tokens
       (id, user_id, expo_push_token, platform, device_name)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(expo_push_token) DO UPDATE SET
         user_id = excluded.user_id, enabled = 1, platform = excluded.platform,
         device_name = excluded.device_name, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        payload.token,
        payload.platform || null,
        payload.deviceName || null,
      )
      .run();
    return { body: { ok: true } };
  }

  if (request.method === "GET" && url.pathname === "/v1/settings") {
    const denied = await authorize(env, user, "read");
    if (denied) return { body: { error: denied }, status: 403 };

    const workspace = await env.DB.prepare(
      "SELECT * FROM workspace_settings WHERE id = 'default'",
    ).first<any>();
    const preferences = await env.DB.prepare(
      "SELECT * FROM notification_preferences WHERE user_id = ?",
    )
      .bind(user.id)
      .first<any>();
    // Legacy clients render these operational controls inside Notifications. Always read the
    // effective workspace defaults so a channel edit cannot reintroduce an obsolete personal policy.
    if (preferences) {
      preferences.prepublish_minutes = workspace?.default_prepublish_minutes ?? 30;
      preferences.no_response_policy = workspace?.default_no_response_policy ?? "hold";
    }
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
            review_ready_enabled: 1,
            prepublish_enabled: 1,
            publish_success_enabled: 1,
            publish_failure_enabled: 1,
            prepublish_minutes: workspace?.default_prepublish_minutes || 30,
            no_response_policy: workspace?.default_no_response_policy || "auto_publish",
          },
        },
      },
    };
  }

  if (request.method === "POST" && url.pathname === "/v1/settings") {
    const payload = await request.json<any>().catch(() => null);
    const denied = await authorize(
      env,
      user,
      (payload?.workspace && Object.keys(payload.workspace).length) ||
        payload?.notifications?.noResponsePolicy !== undefined ||
        payload?.notifications?.prepublishMinutes !== undefined
        ? "settings_manage"
        : "read",
    );
    if (denied) return { body: { error: denied }, status: 403 };
    const invalid = validateSettings(payload);
    if (invalid) return { body: { error: invalid }, status: 400 };
    const n = payload.notifications || {};
    // Older owner clients sent publishing controls in notifications. Translate them to workspace
    // defaults while retaining their legacy columns for backwards-compatible reads.
    const w = {
      ...(payload.workspace || {}),
      ...(n.noResponsePolicy !== undefined ? { defaultNoResponsePolicy: n.noResponsePolicy } : {}),
      ...(n.prepublishMinutes !== undefined
        ? { defaultPrepublishMinutes: n.prepublishMinutes }
        : {}),
    };

    if (!Object.keys(w).length && payload.notifications === undefined)
      return { body: { ok: true } };
    await env.DB.batch([
      ...(Object.keys(w).length
        ? [
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
         WHERE id = 'default'`,
            ).bind(
              w.timezone || null,
              w.defaultPrepublishMinutes ?? null,
              w.defaultNoResponsePolicy || null,
              w.minPostSpacingMinutes ?? null,
              w.maxPostsPerDay ?? null,
              w.preferredWindows ? JSON.stringify(w.preferredWindows) : null,
              w.blackoutWindows ? JSON.stringify(w.blackoutWindows) : null,
              w.analyticsRefreshHours ?? null,
            ),
          ]
        : []),
      ...(Object.keys(w).length
        ? [
            env.DB.prepare(
              "UPDATE clients SET schedule_revision=schedule_revision+1 WHERE status='active'",
            ),
          ]
        : []),
      ...(payload.notifications !== undefined
        ? [
            env.DB.prepare(
              `INSERT INTO notification_preferences
         (user_id, email_enabled, push_enabled, in_app_enabled, review_email_enabled,
          review_ready_enabled, prepublish_enabled, publish_success_enabled, publish_failure_enabled,
          prepublish_minutes, no_response_policy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?,(SELECT default_prepublish_minutes FROM workspace_settings WHERE id='default')), COALESCE(?,(SELECT default_no_response_policy FROM workspace_settings WHERE id='default')))
         ON CONFLICT(user_id) DO UPDATE SET
           email_enabled = CASE WHEN ? THEN notification_preferences.email_enabled ELSE excluded.email_enabled END,
           push_enabled = CASE WHEN ? THEN notification_preferences.push_enabled ELSE excluded.push_enabled END,
           in_app_enabled = CASE WHEN ? THEN notification_preferences.in_app_enabled ELSE excluded.in_app_enabled END,
           review_email_enabled = CASE WHEN ? THEN notification_preferences.review_email_enabled ELSE excluded.review_email_enabled END,
           review_ready_enabled = CASE WHEN ? THEN notification_preferences.review_ready_enabled ELSE excluded.review_ready_enabled END,
           prepublish_enabled = CASE WHEN ? THEN notification_preferences.prepublish_enabled ELSE excluded.prepublish_enabled END,
           publish_success_enabled = CASE WHEN ? THEN notification_preferences.publish_success_enabled ELSE excluded.publish_success_enabled END,
           publish_failure_enabled = CASE WHEN ? THEN notification_preferences.publish_failure_enabled ELSE excluded.publish_failure_enabled END,
           prepublish_minutes = CASE WHEN ? THEN notification_preferences.prepublish_minutes ELSE excluded.prepublish_minutes END,
           no_response_policy = CASE WHEN ? THEN notification_preferences.no_response_policy ELSE excluded.no_response_policy END,
           updated_at = CURRENT_TIMESTAMP`,
            ).bind(
              user.id,
              n.emailEnabled === false ? 0 : 1,
              n.pushEnabled === false ? 0 : 1,
              n.inAppEnabled === false ? 0 : 1,
              n.reviewEmailEnabled === false ? 0 : 1,
              n.reviewReadyEnabled === false ? 0 : 1,
              n.prepublishEnabled === false ? 0 : 1,
              n.publishSuccessEnabled === false ? 0 : 1,
              n.publishFailureEnabled === false ? 0 : 1,
              n.prepublishMinutes ?? null,
              n.noResponsePolicy ?? null,
              n.emailEnabled === undefined ? 1 : 0,
              n.pushEnabled === undefined ? 1 : 0,
              n.inAppEnabled === undefined ? 1 : 0,
              n.reviewEmailEnabled === undefined ? 1 : 0,
              n.reviewReadyEnabled === undefined ? 1 : 0,
              n.prepublishEnabled === undefined ? 1 : 0,
              n.publishSuccessEnabled === undefined ? 1 : 0,
              n.publishFailureEnabled === undefined ? 1 : 0,
              n.prepublishMinutes === undefined ? 1 : 0,
              n.noResponsePolicy === undefined ? 1 : 0,
            ),
          ]
        : []),
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

    const days = Number(url.searchParams.get("days") || 30);
    if (![7, 30, 90].includes(days))
      return { body: { error: "Choose 7, 30 or 90 days." }, status: 400 };
    const allowedClients = await accessibleClientIds(env.DB, user);
    if (!clientId && allowedClients !== null && allowedClients.length === 0) {
      return {
        body: {
          data: {
            overview: {
              posts: 0,
              impressions: 0,
              reach: 0,
              likes: 0,
              comments: 0,
              shares: 0,
              clicks: 0,
              saves: 0,
            },
            byPlatform: [],
            history: [],
            topPosts: [],
            syncHealth: [],
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

    // UTC publication cohort. All totals, rankings and trend points use these same posts.
    const rangeStart = new Date();
    rangeStart.setUTCHours(0, 0, 0, 0);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - days + 1);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + days);
    filter = `${filter || "WHERE 1=1"} AND p.status='published' AND datetime(p.published_at)>=datetime(?) AND datetime(p.published_at)<datetime(?)`;
    bindings.push(rangeStart.toISOString(), rangeEnd.toISOString());
    const latestMetrics = latestMetricsJoin;

    const overviewStatement = env.DB.prepare(
      `SELECT
         COUNT(DISTINCT p.id) AS posts, COUNT(pm.id) AS measured_posts, MIN(pm.measured_at) AS oldest_measurement, MAX(pm.measured_at) AS latest_measurement,
         COUNT(pm.impressions) AS impressions_measured_posts, SUM(pm.impressions) AS impressions,
         COUNT(pm.reach) AS reach_measured_posts, SUM(pm.reach) AS reach,
         COUNT(pm.likes) AS likes_measured_posts, SUM(pm.likes) AS likes,
         COUNT(pm.comments) AS comments_measured_posts, SUM(pm.comments) AS comments,
         COUNT(pm.shares) AS shares_measured_posts, SUM(pm.shares) AS shares,
         COUNT(pm.clicks) AS clicks_measured_posts, SUM(pm.clicks) AS clicks,
         COUNT(pm.saves) AS saves_measured_posts, SUM(pm.saves) AS saves
       FROM posts p
       ${latestMetrics}
       ${filter}`,
    );
    const overview = bindings.length
      ? await overviewStatement.bind(...bindings).first<any>()
      : await overviewStatement.first<any>();

    const refreshHours = Number(
      (
        await env.DB.prepare(
          "SELECT analytics_refresh_hours FROM workspace_settings WHERE id='default'",
        ).first<any>()
      )?.analytics_refresh_hours || 6,
    );
    overview.measurement_status = !overview.posts
      ? "empty"
      : !overview.measured_posts
        ? "unavailable"
        : overview.measured_posts < overview.posts
          ? "partial"
          : Date.now() -
                Date.parse(
                  String(overview.oldest_measurement).replace(" ", "T") +
                    (String(overview.oldest_measurement).includes("T") ? "" : "Z"),
                ) >
              refreshHours * 3600000
            ? "stale"
            : "current";
    const platformFilter = filter
      ? `${filter} AND p.status='published'`
      : "WHERE p.status='published'";
    const platformStatement = env.DB.prepare(
      `SELECT p.platform,
         COUNT(DISTINCT p.id) AS posts,
         SUM(pm.impressions) AS impressions,
         SUM(pm.reach) AS reach,
         SUM(pm.likes) AS likes,
         SUM(pm.comments) AS comments,
         SUM(pm.shares) AS shares,
         SUM(pm.clicks) AS clicks,
         SUM(pm.saves) AS saves
       FROM posts p
       ${latestMetrics}
       ${platformFilter}
       GROUP BY p.platform
       ORDER BY impressions DESC, posts DESC`,
    );
    const byPlatform = bindings.length
      ? await platformStatement.bind(...bindings).all<any>()
      : await platformStatement.all<any>();

    const topStatement = env.DB.prepare(
      `SELECT p.id,p.title,p.platform,p.client_id,c.name AS client_name,p.platform_url,
         p.published_at,
         pm.impressions AS impressions,
         pm.reach AS reach,
         pm.likes AS likes,
         pm.comments AS comments,
         pm.shares AS shares,
         pm.clicks AS clicks,
         pm.saves AS saves
       FROM posts p
       JOIN clients c ON c.id=p.client_id
       ${latestMetrics}
       ${platformFilter}
       ORDER BY (COALESCE(pm.likes,0)+COALESCE(pm.comments,0)*2+COALESCE(pm.shares,0)*3+COALESCE(pm.saves,0)*2+COALESCE(pm.clicks,0)*2) DESC,
                COALESCE(pm.impressions,0) DESC
       LIMIT 10`,
    );
    const topPosts = bindings.length
      ? await topStatement.bind(...bindings).all<any>()
      : await topStatement.all<any>();

    const history = (
      await env.DB.prepare(`
      WITH RECURSIVE days(day) AS (
        SELECT date(?) UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<date(?,'-1 day')
      )
      SELECT d.day, COUNT(p.id) AS posts,
        SUM(pm.impressions) AS impressions, SUM(pm.reach) AS reach,
        SUM(pm.likes) AS likes,SUM(pm.comments) AS comments,SUM(pm.shares) AS shares,
        SUM(pm.clicks) AS clicks,SUM(pm.saves) AS saves
      FROM days d LEFT JOIN posts p ON p.id IN (SELECT p.id FROM posts p ${filter})
        AND date(p.published_at)<=d.day
      LEFT JOIN post_metrics pm ON pm.rowid=(SELECT m.rowid FROM post_metrics m
        WHERE m.post_id=p.id AND (m.impressions IS NOT NULL OR m.reach IS NOT NULL OR m.likes IS NOT NULL OR m.comments IS NOT NULL OR m.shares IS NOT NULL OR m.clicks IS NOT NULL OR m.saves IS NOT NULL) AND date(m.measured_at)<=d.day
        ORDER BY datetime(m.measured_at) DESC,m.rowid DESC LIMIT 1)
      GROUP BY d.day ORDER BY d.day
    `)
        .bind(rangeStart.toISOString(), rangeEnd.toISOString(), ...bindings)
        .all<any>()
    ).results;

    let healthQuery = `SELECT r.id,r.social_account_id,r.status,r.started_at,r.completed_at,r.error_message,
       sa.platform,sa.account_name,sa.client_id,c.name AS client_name
       FROM analytics_sync_runs r
       LEFT JOIN social_accounts sa ON sa.id=r.social_account_id
       LEFT JOIN clients c ON c.id=sa.client_id`;
    const healthBindings: string[] = [];
    if (clientId) {
      healthQuery += " WHERE sa.client_id=?";
      healthBindings.push(clientId);
    } else if (allowedClients !== null) {
      healthQuery += ` WHERE sa.client_id IN (${allowedClients.map(() => "?").join(",")})`;
      healthBindings.push(...allowedClients);
    }
    healthQuery += " ORDER BY r.started_at DESC,r.rowid DESC LIMIT 20";
    const syncHealth = healthBindings.length
      ? await env.DB.prepare(healthQuery)
          .bind(...healthBindings)
          .all<any>()
      : await env.DB.prepare(healthQuery).all<any>();

    return {
      body: {
        data: {
          overview,
          byPlatform: byPlatform.results,
          history,
          topPosts: topPosts.results,
          syncHealth: syncHealth.results,
          days,
          range: {
            start: rangeStart.toISOString(),
            end: rangeEnd.toISOString(),
            timezone: "UTC",
            semantics:
              "Lifetime measurements for posts published in the selected UTC range; trend shows measurements available by each day.",
          },
        },
      },
    };
  }

  if (request.method === "GET" && url.pathname === "/v1/analytics/jobs") {
    const rows =
      await env.DB.prepare(`SELECT j.*,sa.client_id,sa.account_name FROM analytics_jobs j JOIN social_accounts sa ON sa.id=j.social_account_id
    WHERE (?='owner' OR EXISTS(SELECT 1 FROM user_client_access a WHERE a.user_id=? AND a.client_id=sa.client_id)) ORDER BY CASE WHEN j.status IN ('queued','running') THEN 0 ELSE 1 END,j.created_at DESC,j.id DESC LIMIT 100`)
        .bind(user.role, user.id)
        .all();
    return { body: { data: rows.results } };
  }
  if (request.method === "POST" && url.pathname === "/v1/analytics/sync") {
    const payload = await request
      .json<{ accountId?: string; days?: number }>()
      .catch(() => ({}) as any);
    if (
      payload.days !== undefined &&
      (!Number.isInteger(payload.days) || payload.days < 1 || payload.days > 365)
    )
      return { body: { error: "Choose a date range between 1 and 365 days." }, status: 400 };
    const allowedClients = await accessibleClientIds(env.DB, user);
    let accounts: Array<{ id: string; client_id: string }> = [];

    if (payload.accountId) {
      const account = await env.DB.prepare(
        "SELECT id,client_id FROM social_accounts WHERE id=? AND status='connected'",
      )
        .bind(payload.accountId)
        .first<{ id: string; client_id: string }>();
      if (!account) return { body: { error: "Connected social account not found." }, status: 404 };
      const clientDenied = await authorize(env, user, "analytics_manage", account.client_id);
      if (clientDenied) return { body: { error: clientDenied }, status: 403 };
      accounts = [account];
    } else {
      const rows = await env.DB.prepare(
        `SELECT id,client_id FROM social_accounts sa WHERE status='connected'
         AND (?='owner' OR EXISTS(SELECT 1 FROM user_client_access a WHERE a.user_id=? AND a.client_id=sa.client_id)) ORDER BY id LIMIT 21`,
      )
        .bind(user.role, user.id)
        .all<{ id: string; client_id: string }>();
      if (rows.results.length > 20)
        return {
          body: {
            error:
              "Bulk sync supports 20 accounts per request. Select a client in Analytics and sync its accounts.",
          },
          status: 400,
        };
      accounts =
        allowedClients === null
          ? rows.results
          : rows.results.filter((row) => allowedClients.includes(row.client_id));
    }

    const permitted = [];
    for (const account of accounts)
      if (!(await authorize(env, user, "analytics_manage", account.client_id)))
        permitted.push(account);
    if (!permitted.length && !hasPermission(user, "analytics_manage"))
      return { body: { error: "Analytics permission is required." }, status: 403 };
    const results = [];
    for (const account of permitted) {
      try {
        const job = await enqueueAnalytics(env, account.id, payload.days || 90);
        results.push({ accountId: account.id, ok: true, jobId: job.id, status: job.status });
      } catch (error) {
        results.push({
          accountId: account.id,
          ok: false,
          error: error instanceof Error ? error.message : "Analytics sync failed.",
        });
      }
    }

    return { body: { ok: results.every((row) => row.ok), results }, status: 202 };
  }

  const validateMatch = url.pathname.match(/^\/v1\/clients\/([^/]+)\/schedule\/validate$/);
  if (validateMatch && request.method === "POST") {
    const denied = await authorize(env, user, "calendar_manage", validateMatch[1]);
    if (denied) return { body: { error: denied }, status: 403 };

    const payload = await request.json<{ scheduledAt?: string }>().catch(() => ({}) as any);
    if (!payload.scheduledAt) return { body: { error: "scheduledAt is required." }, status: 400 };
    return { body: { data: await validateSchedule(env, validateMatch[1], payload.scheduledAt) } };
  }

  const recommendMatch = url.pathname.match(/^\/v1\/clients\/([^/]+)\/schedule\/recommend$/);
  if (recommendMatch && request.method === "POST") {
    const denied = await authorize(env, user, "calendar_manage", recommendMatch[1]);
    if (denied) return { body: { error: denied }, status: 403 };

    const payload = await request.json<{ desiredAt?: string }>().catch(() => ({}) as any);
    return {
      body: {
        data: {
          scheduledAt: await findNextAvailableSlot(env, recommendMatch[1], payload.desiredAt),
        },
      },
    };
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

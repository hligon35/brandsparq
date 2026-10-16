import { hasClientAccess } from "./authz";

export interface NotificationEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_FROM_NAME?: string;
  REVIEW_BASE_URL?: string;
}

type NotifyInput = {
  userId?: string | null;
  postId?: string | null;
  type: string;
  title: string;
  body: string;
  deepLink?: string | null;
  email?: string | null;
  suppressEmail?: boolean;
};

type DeliveryResult = {
  ok: boolean;
  providerMessageId?: string | null;
  error?: string | null;
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char] || char,
  );
}

function eventPreferenceColumn(type: string) {
  if (type.includes("review")) return "review_ready_enabled";
  if (type.includes("prepublish") || type.includes("pre_publish")) return "prepublish_enabled";
  if (type.includes("failed") || type.includes("failure")) return "publish_failure_enabled";
  if (type.includes("published") || type.includes("success")) return "publish_success_enabled";
  return null;
}

async function sendEmail(
  env: NotificationEnv,
  to: string,
  input: NotifyInput,
  idempotencyKey?: string,
): Promise<DeliveryResult> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return { ok: false, error: "Resend is not configured." };
  }

  const title = escapeHtml(input.title);
  const body = escapeHtml(input.body);
  const href = input.deepLink ? escapeHtml(input.deepLink) : null;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `${env.RESEND_FROM_NAME || "BrandSparQ"} <${env.RESEND_FROM_EMAIL}>`,
      to: [to],
      subject: input.title,
      html: `<!doctype html>
<html>
<body style="margin:0;background:#F4F8FF;font-family:Arial,sans-serif;color:#10233F">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F4F8FF;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#FFFFFF;border:1px solid #DCE8F8;border-radius:18px;overflow:hidden">
        <tr><td style="padding:24px 28px;background:#071B33">
          <div style="font-size:21px;font-weight:900;letter-spacing:.01em;color:#FFFFFF">Brand<span style="color:#29C7F6">Spar</span><span style="color:#FF8A2B">Q</span></div>
          <div style="margin-top:5px;font-size:10px;letter-spacing:.16em;font-weight:800;color:#A9C7E8">CREATE. CAPTION. POST.</div>
        </td></tr>
        <tr><td style="padding:30px 28px">
          <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;color:#10233F">${title}</h1>
          <p style="margin:0;font-size:16px;line-height:1.6;color:#52667F">${body}</p>
          ${href ? `<p style="margin:26px 0 0"><a href="${href}" style="display:inline-block;background:#087CF0;color:#FFFFFF;text-decoration:none;padding:13px 19px;border-radius:12px;font-weight:800">Open BrandSparQ</a></p>` : ""}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #E5EDF7;font-size:12px;color:#8292A7">BrandSparQ · Your AI marketing production workspace</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    }),
  });

  const payload = await response.json<any>().catch(() => ({}));
  return response.ok
    ? { ok: true, providerMessageId: payload.id || null }
    : { ok: false, error: payload.message || `Resend returned ${response.status}.` };
}

async function sendExpoPush(token: string, input: NotifyInput): Promise<DeliveryResult> {
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "accept-encoding": "gzip, deflate",
    },
    body: JSON.stringify({
      to: token,
      title: input.title,
      body: input.body,
      data: {
        type: input.type,
        postId: input.postId || undefined,
        deepLink: input.deepLink || undefined,
      },
      sound: "default",
    }),
  });

  const payload = await response.json<any>().catch(() => ({}));
  const ticket = payload?.data;
  const ok = response.ok && ticket?.status !== "error";
  return ok
    ? { ok: true, providerMessageId: ticket?.id || null }
    : {
        ok: false,
        error: ticket?.message || payload?.message || `Expo returned ${response.status}.`,
      };
}

async function recordDelivery(
  env: NotificationEnv,
  notificationId: string,
  channel: "in_app" | "email" | "push",
  destination: string | null,
  result: DeliveryResult,
) {
  await env.DB.prepare(
    `INSERT INTO notification_deliveries
     (id,notification_id,channel,destination,status,provider_message_id,error_message,sent_at,retry_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      notificationId,
      channel,
      destination,
      result.ok ? "sent" : "failed",
      result.providerMessageId || null,
      result.error || null,
      result.ok ? new Date().toISOString() : null,
      result.ok ? null : new Date(Date.now() + 60000).toISOString(),
    )
    .run();
}

async function safelyDeliver(send: () => Promise<DeliveryResult>): Promise<DeliveryResult> {
  try {
    return await send();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 1000) : "Delivery failed.",
    };
  }
}

export async function deliverNotification(env: NotificationEnv, input: NotifyInput) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const user = input.userId
    ? await env.DB.prepare(
        `SELECT u.id,u.role,u.email,
                COALESCE(np.email_enabled, 1) AS email_enabled,
                COALESCE(np.push_enabled, 1) AS push_enabled,
                COALESCE(np.in_app_enabled, 1) AS in_app_enabled,
                COALESCE(np.review_email_enabled, 1) AS review_email_enabled,
                COALESCE(np.review_ready_enabled, 1) AS review_ready_enabled,
                COALESCE(np.prepublish_enabled, 1) AS prepublish_enabled,
                COALESCE(np.publish_success_enabled, 1) AS publish_success_enabled,
                COALESCE(np.publish_failure_enabled, 1) AS publish_failure_enabled
         FROM users u
         LEFT JOIN notification_preferences np ON np.user_id = u.id
         WHERE u.id = ?`,
      )
        .bind(input.userId)
        .first<any>()
    : null;

  if (input.postId && input.userId) {
    const post = await env.DB.prepare("SELECT client_id FROM posts WHERE id=?")
      .bind(input.postId)
      .first<{ client_id: string }>();
    if (!post || !user || !(await hasClientAccess(env.DB, user, post.client_id))) {
      return { id: null, sent: false, suppressed: true, error: null };
    }
  }
  const eventColumn = eventPreferenceColumn(input.type);
  const eventEnabled = !eventColumn || Number(user?.[eventColumn] ?? 1) === 1;
  const email = input.email || user?.email || null;

  await env.DB.prepare(
    `INSERT INTO notifications
     (id,user_id,post_id,type,channel,status,scheduled_for,title,body,deep_link)
     VALUES (?,?,?,?, 'multi','queued',?,?,?,?)`,
  )
    .bind(
      id,
      input.userId || null,
      input.postId || null,
      input.type,
      now,
      input.title,
      input.body,
      input.deepLink || null,
    )
    .run();

  if (!eventEnabled) {
    await env.DB.prepare(
      "UPDATE notifications SET status='suppressed', error_message='Disabled by notification preferences' WHERE id=?",
    )
      .bind(id)
      .run();
    return { id, sent: false, suppressed: true, error: null };
  }

  const outcomes: DeliveryResult[] = [];

  if (Number(user?.in_app_enabled ?? 1)) {
    const result = { ok: true } as DeliveryResult;
    outcomes.push(result);
    await recordDelivery(env, id, "in_app", input.userId || null, result);
  }

  const reviewEmailAllowed =
    !input.type.includes("review") || Number(user?.review_email_enabled ?? 1) === 1;
  if (!input.suppressEmail && email && Number(user?.email_enabled ?? 1) && reviewEmailAllowed) {
    const result = await safelyDeliver(() => sendEmail(env, email, input, `${id}:email`));
    outcomes.push(result);
    await recordDelivery(env, id, "email", email, result);
  }

  if (input.userId && Number(user?.push_enabled ?? 1)) {
    const pushTokens = await env.DB.prepare(
      "SELECT expo_push_token FROM device_push_tokens WHERE user_id = ? AND enabled = 1",
    )
      .bind(input.userId)
      .all<{ expo_push_token: string }>();

    for (const row of pushTokens.results) {
      const result = await safelyDeliver(() => sendExpoPush(row.expo_push_token, input));
      outcomes.push(result);
      await recordDelivery(env, id, "push", row.expo_push_token, result);
    }
  }

  const sentCount = outcomes.filter((item) => item.ok).length;
  const failures = outcomes.filter((item) => !item.ok);
  const status = sentCount
    ? failures.length
      ? "partial"
      : "sent"
    : failures.length
      ? "failed"
      : "queued";
  const error =
    failures
      .map((item) => item.error)
      .filter(Boolean)
      .join(" | ")
      .slice(0, 1000) || null;

  await env.DB.prepare(
    `UPDATE notifications SET
     status=?,
     sent_at=?,
     error_message=?
     WHERE id=?`,
  )
    .bind(status, sentCount ? now : null, error, id)
    .run();

  return { id, sent: sentCount > 0, status, error };
}

export async function notifyPostOwners(
  env: NotificationEnv,
  postId: string,
  type: string,
  title: string,
  body: string,
  deepLink?: string,
  options?: { suppressEmail?: boolean },
) {
  const users = await env.DB.prepare(`SELECT u.id FROM users u
    WHERE u.role='owner' OR (u.role='admin' AND EXISTS (
      SELECT 1 FROM user_client_access a JOIN posts p ON p.client_id=a.client_id
      WHERE a.user_id=u.id AND p.id=?))`)
    .bind(postId)
    .all<{
      id: string;
    }>();

  const results = [];
  for (const user of users.results) {
    results.push(
      await deliverNotification(env, {
        userId: user.id,
        postId,
        type,
        title,
        body,
        deepLink,
        suppressEmail: options?.suppressEmail,
      }),
    );
  }
  return results;
}

// Failed transports are retried without calling any publishing adapter.
export async function retryNotificationDeliveries(env: NotificationEnv) {
  const now = new Date().toISOString();
  const rows =
    await env.DB.prepare(`SELECT d.*,n.user_id,n.post_id,n.type,n.title,n.body,n.deep_link,
    u.role,p.client_id,np.email_enabled,np.push_enabled,np.review_email_enabled,
    np.review_ready_enabled,np.prepublish_enabled,np.publish_success_enabled,np.publish_failure_enabled
    FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id
    LEFT JOIN users u ON u.id=n.user_id LEFT JOIN posts p ON p.id=n.post_id
    LEFT JOIN notification_preferences np ON np.user_id=n.user_id
    WHERE d.status='failed' AND d.channel IN ('email','push') AND d.attempt_count<3
      AND d.retry_at<=? AND (d.claim_until IS NULL OR d.claim_until<=?)
      AND datetime(d.created_at)>datetime('now','-1 day')
    ORDER BY d.retry_at LIMIT 25`)
      .bind(now, now)
      .all<any>();
  for (const row of rows.results) {
    const claimed = await env.DB.prepare(`UPDATE notification_deliveries
      SET claim_until=?,attempt_count=attempt_count+1
      WHERE id=? AND status='failed' AND attempt_count<3
        AND (claim_until IS NULL OR claim_until<=?)`)
      .bind(new Date(Date.now() + 120000).toISOString(), row.id, now)
      .run();
    if (!claimed.meta.changes) continue;
    const event = eventPreferenceColumn(row.type);
    const allowed =
      (!row.post_id ||
        (row.client_id &&
          row.user_id &&
          row.role &&
          (await hasClientAccess(
            env.DB,
            { id: row.user_id, role: row.role, email: "" },
            row.client_id,
          )))) &&
      (!event || Number(row[event] ?? 1) === 1) &&
      Number(row[`${row.channel}_enabled`] ?? 1) === 1 &&
      (row.channel !== "email" ||
        !row.type.includes("review") ||
        Number(row.review_email_enabled ?? 1) === 1);
    const device =
      row.channel === "push"
        ? await env.DB.prepare(
            "SELECT id FROM device_push_tokens WHERE user_id=? AND expo_push_token=? AND enabled=1",
          )
            .bind(row.user_id, row.destination)
            .first()
        : true;
    if (!allowed || !device) {
      await env.DB.prepare(
        "UPDATE notification_deliveries SET status='suppressed',claim_until=NULL,retry_at=NULL WHERE id=?",
      )
        .bind(row.id)
        .run();
    } else {
      const input = {
        type: row.type,
        title: row.title,
        body: row.body,
        postId: row.post_id,
        deepLink: row.deep_link,
      };
      const result = await safelyDeliver(() =>
        row.channel === "email"
          ? sendEmail(env, row.destination, input, `${row.notification_id}:email`)
          : sendExpoPush(row.destination, input),
      );
      await env.DB.prepare(
        `UPDATE notification_deliveries SET status=?,provider_message_id=?,error_message=?,sent_at=?,retry_at=?,claim_until=NULL WHERE id=?`,
      )
        .bind(
          result.ok ? "sent" : "failed",
          result.providerMessageId || null,
          result.error || null,
          result.ok ? new Date().toISOString() : null,
          result.ok ? null : new Date(Date.now() + 300000).toISOString(),
          row.id,
        )
        .run();
    }
    const deliveries = await env.DB.prepare(
      "SELECT status,error_message FROM notification_deliveries WHERE notification_id=?",
    )
      .bind(row.notification_id)
      .all<any>();
    const sent = deliveries.results.some((d) => d.status === "sent");
    const failed = deliveries.results.filter((d) => d.status === "failed");
    await env.DB.prepare(
      "UPDATE notifications SET status=?,error_message=?,sent_at=CASE WHEN ? THEN COALESCE(sent_at,?) ELSE sent_at END WHERE id=?",
    )
      .bind(
        sent ? (failed.length ? "partial" : "sent") : failed.length ? "failed" : "suppressed",
        failed
          .map((d) => d.error_message)
          .filter(Boolean)
          .join(" | ")
          .slice(0, 1000) || null,
        sent ? 1 : 0,
        new Date().toISOString(),
        row.notification_id,
      )
      .run();
  }
  return { attempted: rows.results.length };
}

export async function checkExpoPushReceipts(env: NotificationEnv) {
  const rows = await env.DB.prepare(
    `SELECT id,notification_id,destination,provider_message_id
     FROM notification_deliveries
     WHERE channel='push'
       AND status='sent'
       AND provider_message_id IS NOT NULL
       AND receipt_checked_at IS NULL
       AND datetime(sent_at) <= datetime('now','-15 minutes')
     ORDER BY sent_at ASC
     LIMIT 500`,
  ).all<{
    id: string;
    notification_id: string;
    destination: string;
    provider_message_id: string;
  }>();

  if (!rows.results.length) return { checked: 0, failed: 0 };

  let checked = 0;
  let failed = 0;
  for (let offset = 0; offset < rows.results.length; offset += 100) {
    const batch = rows.results.slice(offset, offset + 100);
    const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ ids: batch.map((row) => row.provider_message_id) }),
    });
    if (!response.ok) continue;
    const payload = await response.json<any>().catch(() => ({}));
    const receipts = payload?.data || {};

    for (const row of batch) {
      const receipt = receipts[row.provider_message_id];
      if (!receipt) continue;
      const ok = receipt.status === "ok";
      const error = ok
        ? null
        : receipt.message || receipt.details?.error || "Expo push receipt failed.";
      await env.DB.prepare(
        `UPDATE notification_deliveries
         SET receipt_status=?,receipt_checked_at=CURRENT_TIMESTAMP,
             status=CASE WHEN ?=1 THEN status ELSE 'failed' END,
             error_message=COALESCE(?,error_message)
         WHERE id=?`,
      )
        .bind(receipt.status || "unknown", ok ? 1 : 0, error, row.id)
        .run();
      checked++;

      if (!ok) {
        failed++;
        const remaining = await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM notification_deliveries WHERE notification_id=? AND status='sent'",
        )
          .bind(row.notification_id)
          .first<{ count: number }>();
        await env.DB.prepare(
          "UPDATE notifications SET status=?,error_message=COALESCE(?,error_message) WHERE id=?",
        )
          .bind(
            Number(remaining?.count || 0) > 0 ? "partial" : "failed",
            error,
            row.notification_id,
          )
          .run();

        if (receipt.details?.error === "DeviceNotRegistered" && row.destination) {
          await env.DB.prepare(
            "UPDATE device_push_tokens SET enabled=0,updated_at=CURRENT_TIMESTAMP WHERE expo_push_token=?",
          )
            .bind(row.destination)
            .run();
        }
      }
    }
  }

  return { checked, failed };
}

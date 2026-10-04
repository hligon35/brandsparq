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
};

type DeliveryResult = {
  ok: boolean;
  providerMessageId?: string | null;
  error?: string | null;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char] || char));
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
  input: NotifyInput
): Promise<DeliveryResult> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return { ok: false, error: "Resend is not configured." };
  }

  const title = escapeHtml(input.title);
  const body = escapeHtml(input.body);
  const href = input.deepLink ? escapeHtml(input.deepLink) : null;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
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

async function sendExpoPush(
  token: string,
  input: NotifyInput
): Promise<DeliveryResult> {
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
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
    : { ok: false, error: ticket?.message || payload?.message || `Expo returned ${response.status}.` };
}

async function recordDelivery(
  env: NotificationEnv,
  notificationId: string,
  channel: "in_app" | "email" | "push",
  destination: string | null,
  result: DeliveryResult
) {
  await env.DB.prepare(
    `INSERT INTO notification_deliveries
     (id,notification_id,channel,destination,status,provider_message_id,error_message,sent_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID(),
    notificationId,
    channel,
    destination,
    result.ok ? "sent" : "failed",
    result.providerMessageId || null,
    result.error || null,
    result.ok ? new Date().toISOString() : null
  ).run();
}

export async function deliverNotification(
  env: NotificationEnv,
  input: NotifyInput
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const user = input.userId
    ? await env.DB.prepare(
        `SELECT u.email,
                COALESCE(np.email_enabled, 1) AS email_enabled,
                COALESCE(np.push_enabled, 1) AS push_enabled,
                COALESCE(np.in_app_enabled, 1) AS in_app_enabled,
                COALESCE(np.review_ready_enabled, 1) AS review_ready_enabled,
                COALESCE(np.prepublish_enabled, 1) AS prepublish_enabled,
                COALESCE(np.publish_success_enabled, 1) AS publish_success_enabled,
                COALESCE(np.publish_failure_enabled, 1) AS publish_failure_enabled
         FROM users u
         LEFT JOIN notification_preferences np ON np.user_id = u.id
         WHERE u.id = ?`
      ).bind(input.userId).first<any>()
    : null;

  const eventColumn = eventPreferenceColumn(input.type);
  const eventEnabled = !eventColumn || Number(user?.[eventColumn] ?? 1) === 1;
  const email = input.email || user?.email || null;

  await env.DB.prepare(
    `INSERT INTO notifications
     (id,user_id,post_id,type,channel,status,scheduled_for,title,body,deep_link)
     VALUES (?,?,?,?, 'multi','queued',?,?,?,?)`
  ).bind(
    id,
    input.userId || null,
    input.postId || null,
    input.type,
    now,
    input.title,
    input.body,
    input.deepLink || null
  ).run();

  if (!eventEnabled) {
    await env.DB.prepare(
      "UPDATE notifications SET status='suppressed', error_message='Disabled by notification preferences' WHERE id=?"
    ).bind(id).run();
    return { id, sent: false, suppressed: true, error: null };
  }

  const outcomes: DeliveryResult[] = [];

  if (Number(user?.in_app_enabled ?? 1)) {
    const result = { ok: true } as DeliveryResult;
    outcomes.push(result);
    await recordDelivery(env, id, "in_app", input.userId || null, result);
  }

  if (email && Number(user?.email_enabled ?? 1)) {
    const result = await sendEmail(env, email, input);
    outcomes.push(result);
    await recordDelivery(env, id, "email", email, result);
  }

  if (input.userId && Number(user?.push_enabled ?? 1)) {
    const pushTokens = await env.DB.prepare(
      "SELECT expo_push_token FROM device_push_tokens WHERE user_id = ? AND enabled = 1"
    ).bind(input.userId).all<{ expo_push_token: string }>();

    for (const row of pushTokens.results) {
      const result = await sendExpoPush(row.expo_push_token, input);
      outcomes.push(result);
      await recordDelivery(env, id, "push", row.expo_push_token, result);
    }
  }

  const sentCount = outcomes.filter((item) => item.ok).length;
  const failures = outcomes.filter((item) => !item.ok);
  const status = sentCount
    ? failures.length ? "partial" : "sent"
    : failures.length ? "failed" : "queued";
  const error = failures.map((item) => item.error).filter(Boolean).join(" | ").slice(0, 1000) || null;

  await env.DB.prepare(
    `UPDATE notifications SET
     status=?,
     sent_at=?,
     error_message=?
     WHERE id=?`
  ).bind(status, sentCount ? now : null, error, id).run();

  return { id, sent: sentCount > 0, status, error };
}

export async function notifyPostOwners(
  env: NotificationEnv,
  postId: string,
  type: string,
  title: string,
  body: string,
  deepLink?: string
) {
  const users = await env.DB.prepare(
    "SELECT id FROM users WHERE role IN ('owner','admin')"
  ).all<{ id: string }>();

  const results = [];
  for (const user of users.results) {
    results.push(await deliverNotification(env, {
      userId: user.id,
      postId,
      type,
      title,
      body,
      deepLink,
    }));
  }
  return results;
}

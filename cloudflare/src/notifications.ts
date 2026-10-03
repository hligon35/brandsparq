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

async function sendEmail(env: NotificationEnv, to: string, input: NotifyInput) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) return false;

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
      html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:28px">
        <p style="letter-spacing:.12em;font-weight:800">BRANDSPARQ</p>
        <h1 style="font-size:26px">${input.title}</h1>
        <p style="font-size:16px;line-height:1.5">${input.body}</p>
        ${input.deepLink ? `<p><a href="${input.deepLink}" style="display:inline-block;background:#0B78F6;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Open BrandSparQ</a></p>` : ""}
      </div>`,
    }),
  });

  return response.ok;
}

async function sendExpoPush(token: string, input: NotifyInput) {
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

  return response.ok;
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
                COALESCE(np.in_app_enabled, 1) AS in_app_enabled
         FROM users u
         LEFT JOIN notification_preferences np ON np.user_id = u.id
         WHERE u.id = ?`
      ).bind(input.userId).first<any>()
    : null;

  const email = input.email || user?.email || null;
  const pushTokens = input.userId
    ? await env.DB.prepare(
        "SELECT expo_push_token FROM device_push_tokens WHERE user_id = ? AND enabled = 1"
      ).bind(input.userId).all<{ expo_push_token: string }>()
    : { results: [] as { expo_push_token: string }[] };

  let sent = false;
  let error: string | null = null;

  try {
    if (email && Number(user?.email_enabled ?? 1)) {
      sent = (await sendEmail(env, email, input)) || sent;
    }

    if (Number(user?.push_enabled ?? 1)) {
      for (const row of pushTokens.results) {
        sent = (await sendExpoPush(row.expo_push_token, input)) || sent;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Notification delivery failed";
  }

  await env.DB.prepare(
    `INSERT INTO notifications
     (id, user_id, post_id, type, channel, status, scheduled_for, sent_at,
      error_message, title, body, deep_link)
     VALUES (?, ?, ?, ?, 'multi', ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    input.userId || null,
    input.postId || null,
    input.type,
    sent ? "sent" : error ? "failed" : "queued",
    now,
    sent ? now : null,
    error,
    input.title,
    input.body,
    input.deepLink || null
  ).run();

  return { id, sent, error };
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

  for (const user of users.results) {
    await deliverNotification(env, {
      userId: user.id,
      postId,
      type,
      title,
      body,
      deepLink,
    });
  }
}

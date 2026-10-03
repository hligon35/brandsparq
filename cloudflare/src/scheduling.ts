export interface SchedulingEnv {
  DB: D1Database;
}

type Rules = {
  timezone: string;
  minSpacing: number;
  maxPerDay: number;
  preferredWindows: string[];
  blackoutWindows: string[];
  allowedWeekdays: number[];
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function minutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function inWindow(date: Date, windows: string[]) {
  if (!windows.length) return true;
  const total = date.getHours() * 60 + date.getMinutes();
  return windows.some((window) => {
    const [start, end] = window.split("-");
    return total >= minutes(start) && total <= minutes(end);
  });
}

function inBlackout(date: Date, windows: string[]) {
  if (!windows.length) return false;
  const total = date.getHours() * 60 + date.getMinutes();
  return windows.some((window) => {
    const [start, end] = window.split("-");
    return total >= minutes(start) && total <= minutes(end);
  });
}

async function loadRules(env: SchedulingEnv, clientId: string): Promise<Rules> {
  const row = await env.DB.prepare(
    `SELECT c.timezone,
            COALESCE(cs.min_post_spacing_minutes, ws.min_post_spacing_minutes) AS min_spacing,
            COALESCE(cs.max_posts_per_day, ws.max_posts_per_day) AS max_posts_per_day,
            COALESCE(cs.preferred_windows, ws.preferred_windows) AS preferred_windows,
            COALESCE(cs.blackout_windows, ws.blackout_windows) AS blackout_windows,
            COALESCE(cs.allowed_weekdays, '[0,1,2,3,4,5,6]') AS allowed_weekdays
     FROM clients c
     JOIN workspace_settings ws ON ws.id = 'default'
     LEFT JOIN client_settings cs ON cs.client_id = c.id
     WHERE c.id = ?`
  )
    .bind(clientId)
    .first<any>();

  if (!row) throw new Error("Client scheduling settings not found.");

  return {
    timezone: row.timezone || "America/Indiana/Indianapolis",
    minSpacing: Number(row.min_spacing || 180),
    maxPerDay: Number(row.max_posts_per_day || 3),
    preferredWindows: parseJson(row.preferred_windows, ["09:00-11:00", "17:00-20:00"]),
    blackoutWindows: parseJson(row.blackout_windows, []),
    allowedWeekdays: parseJson(row.allowed_weekdays, [0,1,2,3,4,5,6]),
  };
}

export async function findNextAvailableSlot(
  env: SchedulingEnv,
  clientId: string,
  desiredAt?: string | null
) {
  const rules = await loadRules(env, clientId);
  let candidate = desiredAt && !Number.isNaN(Date.parse(desiredAt))
    ? new Date(desiredAt)
    : new Date(Date.now() + 60 * 60 * 1000);

  candidate.setSeconds(0, 0);

  for (let attempt = 0; attempt < 14 * 24 * 4; attempt += 1) {
    const weekday = candidate.getDay();
    const dateKey = candidate.toISOString().slice(0, 10);

    if (
      rules.allowedWeekdays.includes(weekday) &&
      inWindow(candidate, rules.preferredWindows) &&
      !inBlackout(candidate, rules.blackoutWindows)
    ) {
      const dayCount = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM posts
         WHERE client_id = ?
           AND scheduled_publish_at >= ?
           AND scheduled_publish_at < ?
           AND status NOT IN ('canceled','failed')`
      )
        .bind(
          clientId,
          `${dateKey}T00:00:00.000Z`,
          `${dateKey}T23:59:59.999Z`
        )
        .first<{ count: number }>();

      const collision = await env.DB.prepare(
        `SELECT id FROM posts
         WHERE client_id = ?
           AND scheduled_publish_at IS NOT NULL
           AND ABS(strftime('%s', scheduled_publish_at) - strftime('%s', ?)) < ?
           AND status NOT IN ('canceled','failed')
         LIMIT 1`
      )
        .bind(clientId, candidate.toISOString(), rules.minSpacing * 60)
        .first();

      if (Number(dayCount?.count || 0) < rules.maxPerDay && !collision) {
        return candidate.toISOString();
      }
    }

    candidate = new Date(candidate.getTime() + 15 * 60 * 1000);
  }

  throw new Error("No available publishing slot found in the next 14 days.");
}

export async function validateSchedule(
  env: SchedulingEnv,
  clientId: string,
  scheduledAt: string
) {
  const suggested = await findNextAvailableSlot(env, clientId, scheduledAt);
  return {
    requested: scheduledAt,
    suggested,
    conflict: suggested !== new Date(scheduledAt).toISOString(),
  };
}

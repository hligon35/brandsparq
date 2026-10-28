import { renderFinalCopy, finalCopyError } from "../../src/shared/final-copy";
import { postCampaign } from "./campaign-workflow";
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

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    weekday: weekdayMap[map.weekday] ?? 0,
    minuteOfDay: Number(map.hour) * 60 + Number(map.minute),
  };
}

function matchesWindow(minuteOfDay: number, window: string) {
  const [start, end] = window.split("-");
  if (!start || !end) return false;
  const startMinute = minutes(start);
  const endMinute = minutes(end);

  // Support windows that cross midnight, e.g. 22:00-02:00.
  if (endMinute < startMinute) {
    return minuteOfDay >= startMinute || minuteOfDay <= endMinute;
  }
  return minuteOfDay >= startMinute && minuteOfDay <= endMinute;
}

export function inPreferredWindow(minuteOfDay: number, windows: string[]) {
  // No preferred windows means unrestricted.
  return windows.length === 0 || windows.some((window) => matchesWindow(minuteOfDay, window));
}

export function inBlackoutWindow(minuteOfDay: number, windows: string[]) {
  // No blackout windows means no blackout.
  return windows.length > 0 && windows.some((window) => matchesWindow(minuteOfDay, window));
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
     WHERE c.id = ?`,
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
    allowedWeekdays: parseJson(row.allowed_weekdays, [0, 1, 2, 3, 4, 5, 6]),
  };
}

export async function findNextAvailableSlot(
  env: SchedulingEnv,
  clientId: string,
  desiredAt?: string | null,
  excludePostId?: string | null,
) {
  const rules = await loadRules(env, clientId);
  const campaign = excludePostId ? await postCampaign(env, excludePostId) : null;
  if (campaign && campaign.status !== "active")
    throw new ScheduleUnavailable("Activate the campaign before scheduling its posts.");
  let candidate =
    desiredAt && !Number.isNaN(Date.parse(desiredAt))
      ? new Date(desiredAt)
      : new Date(Date.now() + 60 * 60 * 1000);

  // Never approve an AI suggestion or a manual date into the past.
  candidate = new Date(Math.max(candidate.getTime(), Date.now() + 60_000));
  if (campaign?.start) candidate = new Date(Math.max(candidate.getTime(), campaign.start));
  candidate.setSeconds(0, 0);
  if (campaign?.start && candidate.getTime() < campaign.start)
    candidate = new Date(Math.ceil(campaign.start / 60000) * 60000);

  for (let attempt = 0; attempt < 14 * 24 * 4; attempt += 1) {
    if (campaign?.end && candidate.getTime() >= campaign.end)
      throw new ScheduleUnavailable("No publishing slot remains inside the campaign dates.");
    const local = localParts(candidate, rules.timezone);

    if (
      rules.allowedWeekdays.includes(local.weekday) &&
      inPreferredWindow(local.minuteOfDay, rules.preferredWindows) &&
      !inBlackoutWindow(local.minuteOfDay, rules.blackoutWindows)
    ) {
      const nearby = await env.DB.prepare(
        `SELECT id, scheduled_publish_at FROM posts
         WHERE client_id = ?
           AND scheduled_publish_at IS NOT NULL
           AND scheduled_publish_at >= ?
           AND scheduled_publish_at <= ?
           AND status NOT IN ('canceled','failed')
           AND (? IS NULL OR id != ?)`,
      )
        .bind(
          clientId,
          new Date(candidate.getTime() - 24 * 60 * 60 * 1000).toISOString(),
          new Date(candidate.getTime() + 24 * 60 * 60 * 1000).toISOString(),
          excludePostId || null,
          excludePostId || null,
        )
        .all<{ id: string; scheduled_publish_at: string }>();

      const sameLocalDay = nearby.results.filter(
        (row) =>
          localParts(new Date(row.scheduled_publish_at), rules.timezone).dateKey === local.dateKey,
      ).length;

      const collision = nearby.results.some(
        (row) =>
          Math.abs(Date.parse(row.scheduled_publish_at) - candidate.getTime()) <
          rules.minSpacing * 60 * 1000,
      );

      if (sameLocalDay < rules.maxPerDay && !collision) {
        return candidate.toISOString();
      }
    }

    candidate = new Date(candidate.getTime() + 15 * 60 * 1000);
  }

  throw new ScheduleUnavailable("No available publishing slot found in the next 14 days.");
}

export async function validateSchedule(
  env: SchedulingEnv,
  clientId: string,
  scheduledAt: string,
  excludePostId?: string | null,
) {
  const requested = new Date(scheduledAt).toISOString();
  const suggested = await findNextAvailableSlot(env, clientId, requested, excludePostId);
  return {
    requested,
    suggested,
    conflict: suggested !== requested,
  };
}

// D1 batches are transactional. Reserve against the calendar epoch read BEFORE
// selecting a slot; a concurrent winner forces a fresh selection. Post state and
// publish version are checked independently so a publisher or another edit wins.
class ScheduleUnavailable extends Error {}

export async function reserveSchedule(
  env: SchedulingEnv,
  postId: string,
  input: {
    clientId: string;
    status: string;
    publishVersion: number;
    desiredAt: string;
    decision?: string;
    resume?: boolean;
    reviewTokenId?: string;
    contentRevision?: number;
    socialAccountId?: string;
  },
): Promise<string | null> {
  const reviewed = await env.DB.prepare(
    "SELECT content_revision,social_account_id,platform,caption,hashtags FROM posts WHERE id=?",
  )
    .bind(postId)
    .first<any>();
  if (!reviewed) return null;
  if (
    input.decision &&
    finalCopyError(reviewed.platform, renderFinalCopy(reviewed.caption || "", reviewed.hashtags))
  )
    return null;
  const contentRevision = input.contentRevision ?? reviewed.content_revision;
  const socialAccountId = input.socialAccountId ?? reviewed.social_account_id;
  for (let attempt = 0; attempt < 8; attempt++) {
    const calendar = await env.DB.prepare(
      "SELECT schedule_revision FROM clients WHERE id=? AND status='active'",
    )
      .bind(input.clientId)
      .first<{ schedule_revision: number }>();
    if (!calendar) return null;
    const campaign = await postCampaign(env, postId);
    if (campaign && campaign.status !== "active") return null;
    let scheduledAt: string;
    try {
      scheduledAt = await findNextAvailableSlot(env, input.clientId, input.desiredAt, postId);
    } catch (error) {
      if (error instanceof ScheduleUnavailable) return null;
      throw error;
    }
    const token = crypto.randomUUID();
    const now = new Date().toISOString();
    const approving = !!input.decision;
    const [changed] = await env.DB.batch([
      env.DB.prepare(`UPDATE posts SET scheduled_publish_at=?,schedule_token=?,
        status=?,prepublish_alert_at=NULL,prepublish_response=?,
        approved_at=CASE WHEN ? THEN ? ELSE approved_at END,
        calendar_added_at=CASE WHEN ? THEN ? ELSE calendar_added_at END,
        publish_version=publish_version+1,updated_at=?
        WHERE id=? AND client_id=? AND status=? AND publish_version=?
          AND content_revision=? AND social_account_id IS ?
          AND (?=0 OR EXISTS(SELECT 1 FROM social_accounts sa WHERE sa.id=posts.social_account_id AND sa.client_id=posts.client_id AND sa.platform=posts.platform
            AND sa.status='connected' AND sa.access_token_ciphertext IS NOT NULL AND COALESCE(sa.health_status,'healthy') NOT IN ('degraded','reauth_required','disconnected')
            AND (sa.token_expires_at IS NULL OR sa.token_expires_at>?)))
          AND platform_post_id IS NULL AND (status!='paused' OR approved_at IS NOT NULL)
          AND (? IS NULL OR EXISTS(SELECT 1 FROM campaigns ca WHERE ca.id=posts.campaign_id AND ca.id=? AND ca.status='active' AND ca.workflow_revision=?))
          AND EXISTS (SELECT 1 FROM clients c WHERE c.id=posts.client_id AND c.status='active' AND c.schedule_revision=?)
          AND NOT EXISTS (SELECT 1 FROM publish_jobs j WHERE j.post_id=posts.id AND j.status='publishing')
          AND (? IS NULL OR EXISTS (SELECT 1 FROM review_tokens rt WHERE rt.id=? AND rt.post_id=posts.id
            AND rt.revoked_at IS NULL AND rt.used_at IS NULL AND rt.expires_at>?))`).bind(
        scheduledAt,
        token,
        approving || input.resume ? "calendar_scheduled" : "rescheduled",
        approving || input.resume ? null : "reschedule",
        approving ? 1 : 0,
        now,
        approving ? 1 : 0,
        now,
        now,
        postId,
        input.clientId,
        input.status,
        input.publishVersion,
        contentRevision,
        socialAccountId,
        approving ? 1 : 0,
        Date.now(),
        campaign?.id || null,
        campaign?.id || null,
        campaign?.workflow_revision ?? null,
        calendar.schedule_revision,
        input.reviewTokenId || null,
        input.reviewTokenId || null,
        Date.now(),
      ),
      env.DB.prepare(`UPDATE clients SET schedule_revision=schedule_revision+1 WHERE id=?
        AND EXISTS (SELECT 1 FROM posts p WHERE p.id=? AND p.schedule_token=?)`).bind(
        input.clientId,
        postId,
        token,
      ),
      env.DB.prepare(`UPDATE publish_jobs SET status='canceled',completed_at=?,updated_at=?
        WHERE post_id=? AND status IN ('queued','retrying')
          AND EXISTS (SELECT 1 FROM posts p WHERE p.id=? AND p.schedule_token=?)`).bind(
        now,
        now,
        postId,
        postId,
        token,
      ),
      ...(input.decision
        ? [
            env.DB.prepare(`INSERT INTO approvals(id,post_id,decision,previous_status)
        SELECT ?,?,?,? FROM posts WHERE id=? AND schedule_token=?`).bind(
              crypto.randomUUID(),
              postId,
              input.decision,
              input.status,
              postId,
              token,
            ),
          ]
        : []),
      ...(input.reviewTokenId
        ? [
            env.DB.prepare(`UPDATE review_tokens SET used_at=? WHERE id=?
        AND EXISTS (SELECT 1 FROM posts WHERE id=? AND schedule_token=?)`).bind(
              Date.now(),
              input.reviewTokenId,
              postId,
              token,
            ),
          ]
        : []),
    ]);
    if (changed.meta.changes) return scheduledAt;
    const current =
      await env.DB.prepare(`SELECT status,publish_version,content_revision,social_account_id,
      EXISTS(SELECT 1 FROM publish_jobs j WHERE j.post_id=posts.id AND j.status='publishing') AS claimed
      FROM posts WHERE id=?`)
        .bind(postId)
        .first<{
          status: string;
          publish_version: number;
          content_revision: number;
          social_account_id: string | null;
          claimed: number;
        }>();
    if (
      !current ||
      current.claimed ||
      current.status !== input.status ||
      current.publish_version !== input.publishVersion ||
      current.content_revision !== contentRevision ||
      current.social_account_id !== socialAccountId
    )
      return null;
  }
  return null;
}

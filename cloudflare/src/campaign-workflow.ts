import { calendarDayStart } from "../../src/shared/calendar-time";
export async function postCampaign(env: { DB: D1Database }, postId: string) {
  const row =
    await env.DB.prepare(`SELECT c.id,c.status,c.starts_at,c.ends_at,c.workflow_revision,cl.timezone FROM campaigns c
    JOIN posts p ON p.campaign_id=c.id JOIN clients cl ON cl.id=c.client_id WHERE p.id=?`)
      .bind(postId)
      .first<any>();
  if (!row) return null;
  return {
    ...row,
    start: campaignBoundary(row.starts_at, row.timezone),
    end: campaignBoundary(row.ends_at, row.timezone, true),
  } as {
    id: string;
    status: string;
    workflow_revision: number;
    start: number | null;
    end: number | null;
  };
}
export function campaignOpen(
  campaign: Awaited<ReturnType<typeof postCampaign>>,
  instant = Date.now(),
) {
  return (
    !campaign ||
    (campaign.status === "active" &&
      (campaign.start === null || instant >= campaign.start) &&
      (campaign.end === null || instant < campaign.end))
  );
}

export function campaignBoundary(value: string | null, timezone: string, end = false) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const carrier = new Date(value + "T00:00:00Z");
    if (end) carrier.setUTCDate(carrier.getUTCDate() + 1);
    return calendarDayStart(carrier, timezone).getTime();
  }
  return Date.parse(value) + (end ? 1 : 0);
}
export function validCampaignDate(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      value,
    )
  )
    return false;
  const date = value.slice(0, 10);
  return (
    Number.isFinite(Date.parse(value)) &&
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date
  );
}

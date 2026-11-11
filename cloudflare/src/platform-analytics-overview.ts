import type { SocialEnv } from "./social";
import { analyticsRange } from "./platform-analytics";
export async function platformAnalyticsOverview(
  env: SocialEnv,
  allowed: string[] | null,
  clientId: string | null,
  days: number,
  accountId: string | null,
) {
  const scope = ["c.status='active'"],
    bindings: string[] = [];
  if (clientId) {
    scope.push("sa.client_id=?");
    bindings.push(clientId);
  }
  if (accountId) {
    scope.push("sa.id=?");
    bindings.push(accountId);
  }
  if (allowed !== null) {
    scope.push(allowed.length ? `sa.client_id IN (${allowed.map(() => "?").join(",")})` : "0=1");
    bindings.push(...allowed);
  }
  const accounts = (
    await env.DB.prepare(
      `SELECT sa.id,sa.client_id,sa.platform,sa.account_name,sa.status,sa.connection_revision,c.name AS client_name FROM social_accounts sa JOIN clients c ON c.id=sa.client_id WHERE ${scope.join(" AND ")} ORDER BY c.name,sa.platform,sa.id`,
    )
      .bind(...bindings)
      .all<any>()
  ).results;
  const range = analyticsRange(days),
    details: any[] = [],
    content: any[] = [],
    history = new Map<string, any>();
  for (const account of accounts) {
    const snapshot = await env.DB.prepare(
      "SELECT * FROM platform_account_insights WHERE social_account_id=? AND range_days=? AND connection_revision=?",
    )
      .bind(account.id, days, account.connection_revision)
      .first<any>();
    const job = await env.DB.prepare(
      "SELECT id,status,error_message,created_at,updated_at,warnings_json,processed,page_count,account_revision FROM analytics_jobs WHERE social_account_id=? AND range_days=? AND scope='platform' ORDER BY created_at DESC,rowid DESC LIMIT 1",
    )
      .bind(account.id, days)
      .first<any>();
    const metrics = snapshot ? JSON.parse(snapshot.metrics_json) : {};
    const stale =
      !!snapshot &&
      (snapshot.range_start !== range.start.toISOString() ||
        Date.now() -
          Date.parse(
            snapshot.measured_at.includes("T") ? snapshot.measured_at : snapshot.measured_at + "Z",
          ) >
          6 * 3600000);
    const status =
      account.status !== "connected"
        ? "disconnected"
        : job?.status === "partial"
          ? "needs_attention"
          : job && ["queued", "running"].includes(job.status)
            ? "syncing"
            : !snapshot
              ? "not_synced"
              : stale
                ? "stale"
                : snapshot.complete
                  ? "current"
                  : "partial";
    details.push({
      ...account,
      metrics,
      measurement_status: status,
      measured_at: snapshot?.measured_at || null,
      range_start: snapshot?.range_start || null,
      range_end: snapshot?.range_end || null,
      job_id: job?.id || null,
      error: job?.error_message || null,
      limitations: job ? JSON.parse(job.warnings_json || "[]") : [],
      processed: job?.processed || 0,
    });
    if (snapshot)
      for (const point of JSON.parse(snapshot.daily_json)) {
        if (
          point.day < range.start.toISOString().slice(0, 10) ||
          point.day >= range.end.toISOString().slice(0, 10)
        )
          continue;
        const row = history.get(point.day) || { day: point.day };
        for (const key of [
          "views",
          "impressions",
          "likes",
          "comments",
          "shares",
          "clicks",
          "interactions",
        ]) {
          if (typeof point[key] === "number") row[key] = (row[key] ?? 0) + point[key];
        }
        if (accounts.length === 1 && typeof point.reach === "number") row.reach = point.reach;
        history.set(row.day, row);
      }
    const posts = (
      await env.DB.prepare(
        `SELECT pc.*,EXISTS(SELECT 1 FROM posts p WHERE p.social_account_id=pc.social_account_id AND p.platform_post_id=pc.external_id) AS from_app FROM platform_content pc WHERE social_account_id=? AND connection_revision=? AND published_at>=? AND published_at<? ORDER BY published_at DESC LIMIT 5001`,
      )
        .bind(
          account.id,
          account.connection_revision,
          range.start.toISOString(),
          range.end.toISOString(),
        )
        .all<any>()
    ).results;
    content.push(
      ...posts.map((row) => ({
        ...JSON.parse(row.metrics_json),
        id: row.external_id,
        title: row.title,
        published_at: row.published_at,
        platform_url: row.platform_url,
        platform: account.platform,
        client_id: account.client_id,
        client_name: account.client_name,
        account_id: account.id,
        account_name: account.account_name,
        from_app: !!row.from_app,
        measured_at: row.measured_at,
      })),
    );
  }
  const metricKeys = [
    "views",
    "impressions",
    "followers",
    "interactions",
    "likes",
    "comments",
    "shares",
    "saves",
    "clicks",
  ];
  const eligible = details.filter(
    (row) =>
      row.range_start === range.start.toISOString() && row.range_end === range.end.toISOString(),
  );
  const overview: any = {
    posts: content.length,
    accounts: details.length,
    measured_accounts: details.filter((row) => row.measured_at).length,
    reach:
      details.length === 1 && eligible.length === 1 ? (eligible[0].metrics.reach ?? null) : null,
  };
  for (const key of metricKeys) {
    const values = (key === "followers" ? details : eligible)
      .map((row) => row.metrics[key])
      .filter((value) => typeof value === "number");
    overview[key] = values.length ? values.reduce((a, b) => a + b, 0) : null;
    overview[`${key}_measured_accounts`] = values.length;
  }
  overview.reach_measured_accounts = overview.reach !== null ? 1 : 0;
  overview.measurement_status = details.some((row) =>
    ["needs_attention", "partial", "disconnected"].includes(row.measurement_status),
  )
    ? "partial"
    : details.some((row) => row.measurement_status === "stale")
      ? "stale"
      : details.length && details.every((row) => row.measurement_status === "current")
        ? "current"
        : overview.measured_accounts
          ? "partial"
          : "unavailable";
  const topPosts = content
    .sort(
      (a, b) =>
        Number(b.likes || 0) +
        Number(b.comments || 0) * 2 +
        Number(b.shares || 0) * 3 -
        (Number(a.likes || 0) + Number(a.comments || 0) * 2 + Number(a.shares || 0) * 3),
    )
    .slice(0, 10);
  const byPlatform = [...new Set(details.map((row) => row.platform))].map((platform) => ({
    platform,
    posts: content.filter((row) => row.platform === platform).length,
    ...Object.fromEntries(
      metricKeys.map((key) => {
        const values = (key === "followers" ? details : eligible)
          .filter((row) => row.platform === platform)
          .map((row) => row.metrics[key])
          .filter((v) => typeof v === "number");
        return [key, values.length ? values.reduce((a, b) => a + b, 0) : null];
      }),
    ),
  }));
  return {
    scope: "platform",
    overview,
    accounts: details,
    byPlatform,
    topPosts,
    history: [...history.values()].sort((a, b) => a.day.localeCompare(b.day)),
    days,
    range: {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      timezone: "UTC",
      semantics:
        "Account insights for the selected UTC period where the provider supports them. Followers are current snapshots. Content counters are lifetime values for content published in the selected period, including posts outside BrandSparQ. Unique reach is never added across days, intervals or accounts.",
    },
  };
}

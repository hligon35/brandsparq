import { accountToken, type SocialAccountRow, type SocialEnv } from "./social";
import { providerFetch } from "./provider-http";
export type Metrics = Record<string, number | null>;
type Content = {
  insightsComplete?: boolean;
  id: string;
  title: string;
  publishedAt: string;
  url: string | null;
  metrics: Metrics;
};
type Summary = {
  metrics: Metrics;
  daily: Array<{ day: string; [key: string]: any }>;
  warnings: string[];
};
const graph = "https://graph.facebook.com/v23.0";
const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const safeUrl = (value: unknown) => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};
export function analyticsRange(days: number, at = new Date()) {
  const end = new Date(at);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: new Date(end.getTime() - days * 86400000), end };
}
class AnalyticsUnavailable extends Error {}
async function call(url: URL | string, token: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await providerFetch(url.toString(), {
      ...init,
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AnalyticsUnavailable(
      "Provider request timed out or could not connect. Retry the sync.",
    );
  }
  const data: any = await response.json().catch(() => null);
  const error = data?.error;
  if (!response.ok || (error && error.code !== "ok")) {
    if (
      [401, 403].includes(response.status) ||
      [10, 190, 200].includes(Number(error?.code)) ||
      /scope|permission|access_token/i.test(String(error?.code))
    )
      throw new AnalyticsUnavailable(
        "Permission required or token expired. Enable analytics permissions and reconnect this account.",
      );
    if (response.status === 429 || [4, 17, 32, 613].includes(Number(error?.code)))
      throw new AnalyticsUnavailable("Provider rate limit reached. Retry later.");
    throw new AnalyticsUnavailable(
      "Provider did not return this metric or content. Check account eligibility, API access and permissions.",
    );
  }
  if (!data || typeof data !== "object")
    throw new AnalyticsUnavailable("Provider returned an invalid analytics response.");
  return data;
}
function endpoint(base: string, path: string, params: Record<string, string | number> = {}) {
  const url = new URL(`${base}/${encodeURIComponent(path).replace(/%2F/g, "/")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}
async function mapBounded<T, R>(values: T[], task: (value: T) => Promise<R>) {
  const result: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, values.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= values.length) return;
        result[i] = await task(values[i]);
      }
    }),
  );
  return result;
}
function sum(values: Array<number | null>) {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
export async function fetchAccountInsights(
  account: SocialAccountRow,
  token: string,
  days: number,
  at = new Date(),
): Promise<Summary> {
  const { start, end } = analyticsRange(days, at),
    metrics: Metrics = {},
    daily = new Map<string, any>(),
    warnings: string[] = [];
  const id = String(account.external_account_id || "");
  if (!id)
    throw new AnalyticsUnavailable(
      "The connected account has no platform identifier. Reconnect it.",
    );
  async function attempt(task: () => Promise<void>, label: string) {
    try {
      await task();
    } catch (e) {
      warnings.push(
        `Error: ${label}: ${e instanceof AnalyticsUnavailable ? e.message : "Analytics unavailable. Retry the sync."}`,
      );
    }
  }
  if (account.platform === "facebook" || account.platform === "instagram") {
    await attempt(async () => {
      const data = await call(
        endpoint(graph, id, {
          fields:
            account.platform === "instagram" ? "followers_count,media_count" : "followers_count",
        }),
        token,
      );
      metrics.followers = n(data.followers_count);
      if (metrics.followers === null)
        throw new AnalyticsUnavailable(
          "Follower count is unavailable. Check profile statistics permissions.",
        );
    }, "Followers");
    const mapping =
      account.platform === "facebook"
        ? {
            page_media_view: "views",
            page_post_engagements: "interactions",
            page_total_media_view_unique: "reach",
          }
        : {
            views: "views",
            reach: "reach",
            total_interactions: "interactions",
            likes: "likes",
            comments: "comments",
            shares: "shares",
            saves: "saves",
          };
    const windows: Array<{ start: Date; end: Date }> = [];
    for (let from = start.getTime(); from < end.getTime(); from += 30 * 86400000)
      windows.push({
        start: new Date(from),
        end: new Date(Math.min(from + 30 * 86400000, end.getTime())),
      });
    await mapBounded(Object.entries(mapping), async ([metric, key]) => {
      const totals: Array<number | null> = [];
      let complete = true;
      for (const window of windows) {
        await attempt(async () => {
          const data = await call(
            endpoint(graph, `${id}/insights`, {
              metric,
              period: "day",
              since: Math.floor(window.start.getTime() / 1000),
              until: Math.floor(window.end.getTime() / 1000),
              ...(account.platform === "instagram" ? { metric_type: "total_value" } : {}),
            }),
            token,
          );
          const row = data.data?.find((r: any) => r.name === metric);
          if (!row)
            throw new AnalyticsUnavailable(
              "This metric is unavailable for the account or selected period.",
            );
          if (account.platform === "instagram") {
            const value = n(row.total_value?.value);
            totals.push(value);
            if (value === null)
              throw new AnalyticsUnavailable(
                "This metric is unavailable for the account or selected period.",
              );
          } else {
            const values = Array.isArray(row.values) ? row.values : [];
            const samples: number[] = [];
            for (const value of values) {
              const day = new Date(Date.parse(value.end_time) - 86400000)
                .toISOString()
                .slice(0, 10);
              const amount = n(value.value);
              if (
                amount === null ||
                day < start.toISOString().slice(0, 10) ||
                day >= end.toISOString().slice(0, 10)
              )
                continue;
              const point = daily.get(day) || { day };
              point[key] = amount;
              daily.set(day, point);
              samples.push(amount);
            }
            if (!samples.length)
              throw new AnalyticsUnavailable(
                "This metric has no available samples for the selected period.",
              );
            totals.push(samples.reduce((a, b) => a + b, 0));
          }
        }, key);
        if (totals.length < windows.indexOf(window) + 1) {
          totals.push(null);
          complete = false;
        }
      }
      // Unique audiences cannot be added across days or disjoint 30-day intervals.
      metrics[key] =
        key === "reach" && (account.platform === "facebook" || windows.length > 1)
          ? null
          : complete && totals.every((value) => value !== null)
            ? sum(totals)
            : null;
    });
    if (account.platform === "instagram") {
      for (const window of windows)
        await attempt(async () => {
          const data = await call(
            endpoint(graph, `${id}/insights`, {
              metric: "reach",
              period: "day",
              metric_type: "time_series",
              since: Math.floor(window.start.getTime() / 1000),
              until: Math.floor(window.end.getTime() / 1000),
            }),
            token,
          );
          const series = data.data?.find((row: any) => row.name === "reach")?.values;
          if (!Array.isArray(series))
            throw new AnalyticsUnavailable("Daily reach is unavailable for this account.");
          for (const value of series) {
            const date = Date.parse(value.end_time);
            const amount = n(value.value);
            if (!Number.isFinite(date) || amount === null) continue;
            const day = new Date(date - 86400000).toISOString().slice(0, 10);
            if (day >= start.toISOString().slice(0, 10) && day < end.toISOString().slice(0, 10))
              daily.set(day, { day, reach: amount });
          }
        }, "Daily reach");
    }
    if (account.platform === "instagram" && windows.length > 1)
      warnings.push(
        "Unique reach is unavailable across multiple 30-day API intervals; it is not summed.",
      );
    if (account.platform === "facebook")
      warnings.push(
        "Facebook reach is shown per day only; unique daily audiences are not added into period reach. Daily totals cover available provider samples; recent dates may be delayed.",
      );
  } else if (account.platform === "x") {
    await attempt(async () => {
      const data = await call(
        endpoint("https://api.x.com/2", `users/${id}`, { "user.fields": "public_metrics" }),
        token,
      );
      metrics.followers = n(data.data?.public_metrics?.followers_count);
      if (metrics.followers === null)
        throw new AnalyticsUnavailable("Follower count is unavailable. Check API access.");
    }, "Followers");
    warnings.push(
      "X content counters are lifetime values for the returned recent timeline. Account-wide period views and reach are not supplied by this integration/API tier.",
    );
  } else if (account.platform === "tiktok") {
    await attempt(async () => {
      const data = await call(
        endpoint("https://open.tiktokapis.com/v2", "user/info/", {
          fields: "open_id,follower_count,video_count,likes_count",
        }),
        token,
      );
      metrics.followers = n(data.data?.user?.follower_count);
      if (metrics.followers === null)
        throw new AnalyticsUnavailable(
          "Follower count is unavailable. Grant user.info.stats and reconnect.",
        );
    }, "TikTok profile (user.info.stats)");
    warnings.push(
      "TikTok content counters are lifetime values for public videos; the Display API does not supply account-wide period views or reach.",
    );
  } else if (account.platform === "linkedin" && account.account_type === "organization") {
    await attempt(async () => {
      const url = endpoint("https://api.linkedin.com/rest", "organizationalEntityShareStatistics", {
        q: "organizationalEntity",
        organizationalEntity: `urn:li:organization:${id}`,
        "timeIntervals.timeGranularityType": "DAY",
        "timeIntervals.timeRange.start": start.getTime(),
        "timeIntervals.timeRange.end": end.getTime(),
      });
      const data = await call(url, token, {
        headers: { "LinkedIn-Version": "202610", "X-Restli-Protocol-Version": "2.0.0" },
      });
      if (!Array.isArray(data.elements) || !data.elements.length)
        throw new AnalyticsUnavailable("Organization statistics are unavailable for this period.");
      for (const row of data.elements) {
        const stats = row.totalShareStatistics || {};
        const day = new Date(row.timeRange?.start || start.getTime()).toISOString().slice(0, 10);
        daily.set(day, {
          day,
          impressions: n(stats.impressionCount),
          likes: n(stats.likeCount),
          comments: n(stats.commentCount),
          shares: n(stats.shareCount),
          clicks: n(stats.clickCount),
        });
      }
      for (const key of ["impressions", "likes", "comments", "shares", "clicks"])
        metrics[key] = sum([...daily.values()].map((row) => row[key]));
    }, "LinkedIn organization insights");
    warnings.push(
      "Organization reach and follower totals are not supplied by this adapter. LinkedIn Marketing/Community Management approval may be required.",
    );
  } else
    throw new AnalyticsUnavailable(
      "Unsupported account: LinkedIn member analytics are unavailable for this integration. Connect an organization Page.",
    );
  return {
    metrics,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    warnings,
  };
}
export async function fetchPlatformContent(
  account: SocialAccountRow,
  token: string,
  days: number,
  cursor: string | null,
  at = new Date(),
): Promise<{ rows: Content[]; cursor: string | null; warnings: string[] }> {
  const { start, end } = analyticsRange(days, at),
    id = String(account.external_account_id || "");
  let source: any[] = [],
    next: string | null = null;
  if (account.platform === "facebook" || account.platform === "instagram") {
    const facebook = account.platform === "facebook";
    const data = await call(
      endpoint(graph, `${id}/${facebook ? "posts" : "media"}`, {
        limit: 20,
        fields: facebook
          ? "id,message,created_time,permalink_url,shares,comments.limit(0).summary(true),reactions.limit(0).summary(true)"
          : "id,caption,timestamp,permalink,like_count,comments_count",
        ...(cursor ? { after: cursor } : {}),
        ...(facebook
          ? { since: Math.floor(start.getTime() / 1000), until: Math.floor(end.getTime() / 1000) }
          : {}),
      }),
      token,
    );
    if (!Array.isArray(data.data))
      throw new AnalyticsUnavailable("Provider returned no readable content list.");
    source = data.data;
    next =
      data.paging?.next && typeof data.paging?.cursors?.after === "string"
        ? data.paging.cursors.after
        : null;
  } else if (account.platform === "x") {
    const data = await call(
      endpoint("https://api.x.com/2", `users/${id}/tweets`, {
        max_results: 100,
        "tweet.fields": "created_at,public_metrics",
        start_time: start.toISOString(),
        end_time: new Date(Math.min(end.getTime(), at.getTime() - 10000)).toISOString(),
        ...(cursor ? { pagination_token: cursor } : {}),
      }),
      token,
    );
    if (data.errors?.length)
      throw new AnalyticsUnavailable(
        "X timeline is unavailable. Check API tier and read permissions.",
      );
    if (!Array.isArray(data.data) && data.meta?.result_count !== 0)
      throw new AnalyticsUnavailable("X returned no readable timeline. Check API access.");
    source = data.data || [];
    next = data.meta?.next_token || null;
  } else if (account.platform === "tiktok") {
    const data = await call(
      endpoint("https://open.tiktokapis.com/v2", "video/list/", {
        fields:
          "id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count",
      }),
      token,
      {
        method: "POST",
        body: JSON.stringify({
          max_count: 20,
          ...(cursor ? { cursor: Number(cursor) } : { cursor: end.getTime() }),
        }),
      },
    );
    if (!Array.isArray(data.data?.videos))
      throw new AnalyticsUnavailable("TikTok returned no readable video list.");
    source = data.data.videos;
    next = data.data.has_more ? String(data.data.cursor) : null;
  } else if (account.platform === "linkedin" && account.account_type === "organization") {
    const data = await call(
      endpoint("https://api.linkedin.com/rest", "posts", {
        q: "author",
        author: `urn:li:organization:${id}`,
        count: 20,
        start: cursor ? Number(cursor) : 0,
        sortBy: "LAST_MODIFIED",
      }),
      token,
      { headers: { "LinkedIn-Version": "202610", "X-Restli-Protocol-Version": "2.0.0" } },
    );
    if (!Array.isArray(data.elements))
      throw new AnalyticsUnavailable(
        "LinkedIn organization content is unavailable. Check Community Management permissions.",
      );
    source = data.elements.filter((row: any) => row.lifecycleState === "PUBLISHED");
    next = data.paging?.links?.some((link: any) => link.rel === "next")
      ? String((Number(cursor) || 0) + 20)
      : null;
  } else
    throw new AnalyticsUnavailable(
      "This account type cannot provide platform content through this integration.",
    );
  const rows: Content[] = [];
  let oldest = Infinity;
  for (const row of source) {
    const timestamp =
      row.timestamp ||
      row.created_time ||
      row.created_at ||
      (row.create_time ? Number(row.create_time) * 1000 : row.createdAt);
    const time = new Date(timestamp).getTime();
    if (!Number.isFinite(time) || !row.id)
      throw new AnalyticsUnavailable(
        "Provider returned invalid content dates or identifiers. Previous content retained.",
      );
    oldest = Math.min(oldest, time);
    if (time < start.getTime() || time >= end.getTime()) continue;
    const m = row.public_metrics || {};
    rows.push({
      id: String(row.id).slice(0, 300),
      title: String(
        row.message ||
          row.caption ||
          row.text ||
          row.title ||
          row.commentary ||
          row.video_description ||
          "Platform post",
      ).slice(0, 500),
      publishedAt: new Date(time).toISOString(),
      url: safeUrl(
        row.permalink_url ||
          row.permalink ||
          row.share_url ||
          (account.platform === "x"
            ? `https://x.com/i/web/status/${encodeURIComponent(row.id)}`
            : account.platform === "linkedin"
              ? `https://www.linkedin.com/feed/update/${encodeURIComponent(row.id)}`
              : null),
      ),
      metrics: {
        views: n(row.view_count ?? m.impression_count),
        likes: n(row.like_count ?? row.reactions?.summary?.total_count ?? m.like_count),
        comments: n(
          row.comments_count ??
            row.comment_count ??
            row.comments?.summary?.total_count ??
            m.reply_count,
        ),
        shares: n(row.share_count ?? row.shares?.count ?? m.retweet_count),
      },
    });
  }
  for (const row of rows)
    row.insightsComplete = !["facebook", "instagram", "linkedin"].includes(account.platform);
  const warnings: string[] = [];
  if (account.platform === "facebook" || account.platform === "instagram")
    await mapBounded(rows, async (row) => {
      try {
        const keys =
          account.platform === "facebook"
            ? {
                post_media_view: "views",
                post_total_media_view_unique: "reach",
                post_clicks: "clicks",
              }
            : { views: "views", reach: "reach", saved: "saves", shares: "shares" };
        const payload = await call(
          endpoint(graph, `${row.id}/insights`, { metric: Object.keys(keys).join(",") }),
          token,
        );
        let known = 0;
        for (const [name, key] of Object.entries(keys)) {
          const metric = payload.data?.find((value: any) => value.name === name);
          const value = n(metric?.values?.[0]?.value ?? metric?.total_value?.value);
          if (value !== null) {
            row.metrics[key] = value;
            known++;
          }
        }
        if (!known)
          throw new AnalyticsUnavailable(
            "Content insights are unavailable for some media types or permissions.",
          );
        row.insightsComplete = true;
      } catch (error) {
        warnings.push(
          `Error: Some content insights are unavailable. ${error instanceof AnalyticsUnavailable ? error.message : "Check API permissions and retry."}`,
        );
      }
    });
  if (account.platform === "linkedin" && account.account_type === "organization")
    await mapBounded(rows, async (row) => {
      try {
        const parameter = row.id.includes(":ugcPost:") ? "ugcPosts" : "shares";
        const payload = await call(
          endpoint("https://api.linkedin.com/rest", "organizationalEntityShareStatistics", {
            q: "organizationalEntity",
            organizationalEntity: `urn:li:organization:${id}`,
            [parameter]: `List(${row.id})`,
          }),
          token,
          { headers: { "LinkedIn-Version": "202610", "X-Restli-Protocol-Version": "2.0.0" } },
        );
        const stats = payload.elements?.[0]?.totalShareStatistics;
        if (!stats)
          throw new AnalyticsUnavailable(
            "Individual organization post statistics are unavailable. Check Community Management access.",
          );
        row.metrics = {
          impressions: n(stats.impressionCount),
          reach: n(stats.uniqueImpressionsCount ?? stats.uniqueImpressionsCounts),
          likes: n(stats.likeCount),
          comments: n(stats.commentCount),
          shares: n(stats.shareCount),
          clicks: n(stats.clickCount),
        };
        row.insightsComplete = Object.values(row.metrics).some((value) => value !== null);
        if (!row.insightsComplete)
          throw new AnalyticsUnavailable(
            "Individual organization post statistics are unavailable.",
          );
      } catch (error) {
        warnings.push(
          `Error: Some LinkedIn content statistics are unavailable. ${error instanceof AnalyticsUnavailable ? error.message : "Retry the sync."}`,
        );
      }
    });
  // LinkedIn sorts by modification time, so an old post cannot terminate its pagination.
  if (account.platform !== "linkedin" && oldest < start.getTime()) next = null;
  if (next && (next === cursor || next.length > 4000))
    throw new AnalyticsUnavailable(
      "Provider pagination did not advance safely. Retry with a shorter range.",
    );
  return { rows, cursor: next, warnings: [...new Set(warnings)] };
}
export async function runPlatformAnalyticsPage(env: SocialEnv, job: any, claim: string) {
  const account = await env.DB.prepare(
    "SELECT sa.* FROM social_accounts sa JOIN clients c ON c.id=sa.client_id WHERE sa.id=? AND c.status='active'",
  )
    .bind(job.social_account_id)
    .first<SocialAccountRow>();
  if (!account || account.status !== "connected")
    throw new AnalyticsUnavailable("Account disconnected. Reconnect before syncing.");
  if (job.account_revision !== null && job.account_revision !== account.connection_revision)
    throw new AnalyticsUnavailable(
      "Connection changed during sync. Start a new sync for the current connection.",
    );
  const token = await accountToken(env, account);
  const guard = `EXISTS(SELECT 1 FROM analytics_jobs j JOIN social_accounts sa ON sa.id=j.social_account_id JOIN clients c ON c.id=sa.client_id WHERE j.id=? AND j.claim_token=? AND sa.connection_revision=? AND sa.status='connected' AND c.status='active')`;
  const fence = [job.id, claim, account.connection_revision];
  const at = new Date(job.created_at.includes("T") ? job.created_at : job.created_at + "Z");
  if (!job.page_count) {
    const summary = await fetchAccountInsights(account, token, job.range_days, at);
    const range = analyticsRange(job.range_days, at);
    // A permission failure must not erase the last good account measurement.
    if (Object.values(summary.metrics).some((value) => value !== null))
      await env.DB.prepare(
        `INSERT INTO platform_account_insights(social_account_id,range_days,range_start,range_end,connection_revision,complete,metrics_json,daily_json) SELECT ?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(social_account_id,range_days) DO UPDATE SET range_start=excluded.range_start,range_end=excluded.range_end,connection_revision=excluded.connection_revision,complete=excluded.complete,metrics_json=excluded.metrics_json,daily_json=excluded.daily_json,measured_at=CURRENT_TIMESTAMP WHERE excluded.complete=1 OR platform_account_insights.complete=0 OR platform_account_insights.connection_revision!=excluded.connection_revision`,
      )
        .bind(
          account.id,
          job.range_days,
          range.start.toISOString(),
          range.end.toISOString(),
          account.connection_revision,
          summary.warnings.some((message) => message.startsWith("Error:")) ? 0 : 1,
          JSON.stringify(summary.metrics),
          JSON.stringify(summary.daily),
          ...fence,
        )
        .run();
    const changed = await env.DB.prepare(
      `UPDATE analytics_jobs SET page_count=1,account_revision=?,warnings_json=?,status='queued',claim_token=NULL,claim_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE ${guard} AND id=?`,
    )
      .bind(account.connection_revision, JSON.stringify(summary.warnings), ...fence, job.id)
      .run();
    return { more: changed.meta.changes > 0 };
  }
  const page = await fetchPlatformContent(account, token, job.range_days, job.platform_cursor, at);
  const statements = page.rows.map((row) =>
    env.DB.prepare(
      `INSERT INTO platform_content(social_account_id,external_id,connection_revision,published_at,title,platform_url,metrics_json,insights_complete,seen_job_id) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(social_account_id,external_id) DO UPDATE SET connection_revision=excluded.connection_revision,published_at=excluded.published_at,title=excluded.title,platform_url=excluded.platform_url,seen_job_id=excluded.seen_job_id,metrics_json=CASE WHEN excluded.insights_complete=1 OR platform_content.insights_complete=0 OR platform_content.connection_revision!=excluded.connection_revision THEN excluded.metrics_json ELSE platform_content.metrics_json END,insights_complete=CASE WHEN platform_content.connection_revision!=excluded.connection_revision THEN excluded.insights_complete ELSE MAX(platform_content.insights_complete,excluded.insights_complete) END,measured_at=CASE WHEN excluded.insights_complete=1 OR platform_content.insights_complete=0 OR platform_content.connection_revision!=excluded.connection_revision THEN CURRENT_TIMESTAMP ELSE platform_content.measured_at END`,
    ).bind(
      account.id,
      row.id,
      account.connection_revision,
      row.publishedAt,
      row.title,
      row.url,
      JSON.stringify(row.metrics),
      row.insightsComplete ? 1 : 0,
      job.id,
      ...fence,
    ),
  );
  const capped = !!page.cursor && job.page_count >= 50;
  const warnings: string[] = [
    ...new Set<string>([...JSON.parse(job.warnings_json || "[]"), ...page.warnings]),
  ];
  if (capped)
    warnings.push(
      "Error: Content history reached the 50-page safety limit. Select a shorter range to retrieve the remaining content.",
    );
  const actionable = warnings.some((message) => message.startsWith("Error:"));
  const more = !!page.cursor && !capped;
  if (!more && !capped) {
    const range = analyticsRange(job.range_days, at);
    statements.push(
      env.DB.prepare(
        `DELETE FROM platform_content WHERE social_account_id=? AND connection_revision=? AND published_at>=? AND published_at<? AND (seen_job_id IS NULL OR seen_job_id!=?) AND ${guard}`,
      ).bind(
        account.id,
        account.connection_revision,
        range.start.toISOString(),
        range.end.toISOString(),
        job.id,
        ...fence,
      ),
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE analytics_jobs SET platform_cursor=?,page_count=page_count+1,processed=processed+?,status=?,error_message=?,warnings_json=?,claim_token=NULL,claim_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE ${guard} AND id=?`,
    ).bind(
      page.cursor,
      page.rows.length,
      more ? "queued" : actionable ? "partial" : "completed",
      actionable
        ? warnings
            .filter((message) => message.startsWith("Error:"))
            .join("\n")
            .slice(0, 4000)
        : null,
      JSON.stringify(warnings),
      ...fence,
      job.id,
    ),
  );
  await env.DB.batch(statements);
  return { more };
}
export function platformAnalyticsError(error: unknown) {
  return error instanceof AnalyticsUnavailable
    ? error.message
    : "Platform analytics sync failed. Previous measurements retained. Retry after checking the connection.";
}

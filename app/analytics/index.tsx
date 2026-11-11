import { useFocusedRefresh } from "@/hooks/useFocusedRefresh";
import { ClientPicker } from "@/components/client-picker";
import { EssentialSection } from "@/components/essential";
import { Link, useLocalSearchParams } from "expo-router";
import { useCapabilities } from "@/auth/capabilities";
import { Alert } from "@/components/feedback";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, Linking } from "react-native";
import { IconButton } from "@/components/icon-button";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, SectionTitle, StatusBadge } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";
import type { Client } from "@/types/domain";

const metrics = [
  ["Published posts", "posts"],
  ["Impressions", "impressions"],
  ["Reach", "reach"],
  ["Likes", "likes"],
  ["Comments", "comments"],
  ["Shares", "shares"],
  ["Clicks", "clicks"],
  ["Saves", "saves"],
] as const;

export default function AnalyticsScreen() {
  const can = useCapabilities();
  const { clientId: requestedClient } = useLocalSearchParams<{ clientId?: string }>();
  const [data, setData] = useState<any>();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(requestedClient || "all");
  const [scope, setScope] = useState<"platform" | "brandsparq">("platform");
  const [accountId, setAccountId] = useState("all");
  const [accounts, setAccounts] = useState<any[]>([]);
  const [days, setDays] = useState(30);
  const [jobs, setJobs] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loadVersion = useRef(0);

  useEffect(() => {
    if (requestedClient) setClientId(requestedClient);
  }, [requestedClient]);

  async function load(isCurrent = refresh.active) {
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    try {
      const [analytics, clientRows, jobRows, accountRows] = await Promise.all([
        api.getAnalyticsOverview(
          clientId === "all" ? undefined : clientId,
          days,
          scope,
          accountId === "all" ? undefined : accountId,
        ),
        api.getClients(),
        api.getAnalyticsJobs(),
        api.getSocialAccounts(clientId === "all" ? undefined : clientId),
      ]);
      if (version !== loadVersion.current || !isCurrent()) return;
      setJobs(
        jobRows.data.filter(
          (job) =>
            job.scope === scope &&
            (accountId === "all" || job.social_account_id === accountId) &&
            (clientId === "all" || job.client_id === clientId),
        ),
      );
      setAccounts(accountRows.data);
      setData({
        ...analytics.data,
        selectedScope: scope,
        selectedAccount: accountId,
        selectedClient: clientId,
        selectedDays: days,
      });
      setClients(clientRows);
    } catch (e) {
      if (version === loadVersion.current && isCurrent())
        setError(e instanceof Error ? e.message : "Unable to load analytics.");
    } finally {
      if (version === loadVersion.current && isCurrent()) setLoading(false);
    }
  }

  const refresh = useFocusedRefresh(
    async (context) => {
      if (
        (syncing && context.reason !== "manual") ||
        (context.reason === "poll" &&
          !jobs.some((job) => ["queued", "running"].includes(job.status)))
      )
        return;
      await load(context.current);
    },
    [clientId, days, scope, accountId],
    5000,
  );

  async function sync() {
    setSyncing(true);
    try {
      const accounts = (await api.getSocialAccounts(clientId === "all" ? undefined : clientId))
        .data;
      const failures: Array<{ error?: string }> = [];
      if (
        !accounts.some(
          (row: any) => row.status === "connected" && (accountId === "all" || row.id === accountId),
        )
      ) {
        Alert.alert("No connected account", "Connect a social account before syncing analytics.");
        return;
      }
      if (clientId === "all" && accountId === "all") {
        const result = await api.syncAnalytics(undefined, days, scope);
        failures.push(...result.results.filter((row) => !row.ok || row.status === "unsupported"));
      } else {
        for (const account of accounts.filter(
          (row: any) => row.status === "connected" && (accountId === "all" || row.id === accountId),
        )) {
          try {
            const result = await api.syncAnalytics(account.id, days, scope);
            failures.push(
              ...result.results.filter((row) => !row.ok || row.status === "unsupported"),
            );
          } catch (e) {
            failures.push({ error: e instanceof Error ? e.message : "Account sync failed." });
          }
        }
      }
      await refresh();
      if (failures.length)
        Alert.alert(
          "Analytics needs attention",
          failures
            .map((row) => row.error || "Provider analytics unavailable for this account.")
            .join("\n"),
        );
    } catch (e) {
      Alert.alert("Analytics sync failed", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSyncing(false);
    }
  }

  const currentData =
    data?.selectedScope === scope &&
    data?.selectedAccount === accountId &&
    data?.selectedClient === clientId &&
    data?.selectedDays === days
      ? data
      : undefined;
  const platform = scope === "platform";
  const overview = currentData?.overview || {};
  const history = (currentData?.history || []).filter((row: any) =>
    [row.views, row.impressions, row.reach].some((value) => value != null),
  );
  const chartKey = history.some((row: any) => row.views != null)
    ? "views"
    : history.some((row: any) => row.impressions != null)
      ? "impressions"
      : "reach";
  const maxImpressions = useMemo(
    () => Math.max(1, ...history.map((row: any) => Number(row[chartKey] || 0))),
    [history, chartKey],
  );

  return (
    <PageScroll>
      <PageHeader
        title="Analytics"
        subtitle="Your content, measured."
        action={
          <IconButton
            label="Sync analytics"
            busy={syncing}
            onPress={
              syncing || !can("analytics_manage", clientId === "all" ? undefined : clientId)
                ? undefined
                : sync
            }
          />
        }
      />

      <Card subtle>
        <ClientPicker
          clients={[{ id: "all", name: "All clients", color: colors.primary }, ...clients]}
          value={clientId}
          onChange={(id) => {
            setClientId(id);
            setAccountId("all");
          }}
        />
        <ClientPicker
          clients={[
            { id: "all", name: "All connected accounts", color: colors.primary },
            ...accounts.map((account) => ({
              id: account.id,
              name: `${account.account_name || account.platform} · ${account.platform}`,
              color: colors.primary,
            })),
          ]}
          value={accountId}
          onChange={setAccountId}
        />
        <View style={styles.rangeRow}>
          <Button
            label="Platform accounts"
            small
            secondary={!platform}
            onPress={() => setScope("platform")}
          />
          <Button
            label="BrandSparQ posts"
            small
            secondary={platform}
            onPress={() => setScope("brandsparq")}
          />
        </View>
        <View style={styles.rangeRow}>
          {[7, 30, 90].map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: days === value }}
              aria-pressed={days === value}
              onPress={() => setDays(value)}
              style={[styles.range, days === value && styles.rangeActive]}
            >
              <Text style={[styles.rangeText, days === value && styles.rangeTextActive]}>
                {value} days
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Link href={{ pathname: "/system", params: clientId === "all" ? {} : { clientId } }} asChild>
        <Button label="Connection & sync health" secondary small />
      </Link>
      {!!error && (
        <Card subtle>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Button label="Try again" onPress={refresh} />
        </Card>
      )}

      {loading && <Text accessibilityLiveRegion="polite">Loading analytics…</Text>}
      {!!currentData && !error && (
        <>
          <EssentialSection title="About these measurements" defaultOpen={false}>
            <StatusBadge label={overview.measurement_status || "unavailable"} />
            {platform ? (
              <>
                <Text style={styles.muted}>
                  Platform account insights include content published outside BrandSparQ. Followers
                  are current snapshots; other account metrics use the selected {days} UTC days
                  where supported.
                </Text>
                <Text style={styles.muted}>
                  — means unavailable, not zero. Reach is shown only for one account when the
                  provider supplies a unique period total. Views and impressions are different
                  measurements. Content counters below are lifetime values for content published
                  during this period.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.muted}>
                  Posts published in the selected {days} UTC days. Values are lifetime provider
                  measurements for those posts, not engagement earned only during the range.
                </Text>
                <Text style={styles.muted}>
                  {overview.measured_posts || 0} of {overview.posts || 0} posts measured.{" "}
                  {overview.oldest_measurement
                    ? `Oldest measurement: ${new Date(overview.oldest_measurement).toLocaleString()}.`
                    : "Metrics unavailable until a successful provider sync."}{" "}
                  Missing metrics display —; a measured zero displays 0.
                </Text>
              </>
            )}
          </EssentialSection>
          <View style={styles.grid}>
            {(platform
              ? [
                  ["Synced content", "posts"],
                  ["Followers", "followers"],
                  ["Views", "views"],
                  ["Impressions", "impressions"],
                  ["Unique reach", "reach"],
                  ["Interactions", "interactions"],
                  ["Likes", "likes"],
                  ["Comments", "comments"],
                ]
              : metrics
            ).map(([label, key]) => (
              <Card key={key} style={styles.metricCard}>
                <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
                  {overview[key] == null ? "—" : Number(overview[key]).toLocaleString()}
                </Text>
                <Text style={styles.label}>{label}</Text>
                {key !== "posts" && (
                  <Text style={styles.muted}>
                    {platform
                      ? `${overview[`${key}_measured_accounts`] || 0}/${overview.accounts || 0} accounts measured`
                      : `${overview[`${key}_measured_posts`] || 0}/${overview.posts || 0} posts measured`}
                  </Text>
                )}
              </Card>
            ))}
          </View>

          {platform && (
            <EssentialSection title="Account insights">
              {!currentData.accounts?.length && (
                <Text style={styles.muted}>
                  No social accounts match this selection. Connect an account to get platform
                  analytics.
                </Text>
              )}
              {(currentData.accounts || []).map((account: any) => (
                <Card key={account.id} subtle>
                  <Text style={styles.platform}>{account.account_name || account.platform}</Text>
                  <Text style={styles.muted}>
                    {account.client_name} · {account.platform}
                  </Text>
                  <StatusBadge label={account.measurement_status} />
                  <Text style={styles.muted}>
                    Followers:{" "}
                    {account.metrics.followers == null
                      ? "—"
                      : Number(account.metrics.followers).toLocaleString()}{" "}
                    · Views:{" "}
                    {account.metrics.views == null
                      ? "—"
                      : Number(account.metrics.views).toLocaleString()}{" "}
                    · Reach:{" "}
                    {account.metrics.reach == null
                      ? "—"
                      : Number(account.metrics.reach).toLocaleString()}
                  </Text>
                  <Text style={styles.muted}>
                    {account.measured_at
                      ? `Measured ${new Date(account.measured_at.includes("T") ? account.measured_at : account.measured_at + "Z").toLocaleString()}`
                      : "Not measured yet. Tap Sync analytics."}
                  </Text>
                  {account.range_start && (
                    <Text style={styles.muted}>
                      Measurement period: {account.range_start.slice(0, 10)} to{" "}
                      {account.range_end.slice(0, 10)} (end exclusive, UTC).
                    </Text>
                  )}
                  {!!account.error && (
                    <Text accessibilityRole="alert" style={styles.error}>
                      {account.error}
                    </Text>
                  )}
                  {!!account.error && account.measured_at && (
                    <Text style={styles.muted}>
                      Previous measurements retained; this attempt did not produce a complete
                      update.
                    </Text>
                  )}
                  {(account.limitations || [])
                    .filter((note: string) => !note.startsWith("Error:"))
                    .map((note: string) => (
                      <Text key={note} style={styles.muted}>
                        {note}
                      </Text>
                    ))}
                  <Link
                    href={{ pathname: "/social", params: { clientId: account.client_id } }}
                    asChild
                  >
                    <Button label="Manage connection" secondary small />
                  </Link>
                </Card>
              ))}
            </EssentialSection>
          )}

          <Card>
            <SectionTitle
              title="Performance trend"
              subtitle={
                platform
                  ? `Daily ${chartKey} supplied by the platform. Gaps mean unavailable; Instagram period totals may have no daily series.`
                  : "Measurements available by each UTC day for the same publication cohort. Gaps mean unavailable."
              }
            />
            {history.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chart}>
                  {history.map((row: any) => (
                    <View key={row.day} style={styles.barColumn}>
                      <Text style={styles.barValue}>
                        {row[chartKey] == null ? "—" : Number(row[chartKey]).toLocaleString()}
                      </Text>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height:
                                `${Math.max(row[chartKey] == null ? 0 : 5, (Number(row[chartKey] || 0) / maxImpressions) * 100)}%` as any,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.barLabel}>
                        {new Date(`${row.day}T12:00:00`).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            ) : (
              <Text style={styles.muted}>
                Daily trends appear when supplied by the provider; period totals and follower
                snapshots do not imply a daily series.
              </Text>
            )}
          </Card>

          <EssentialSection title="Platform performance">
            {(currentData?.byPlatform || []).map((row: any) => (
              <View key={row.platform} style={styles.platformRow}>
                <View>
                  <Text style={styles.platform}>{row.platform}</Text>
                  <Text style={styles.muted}>{row.posts} published</Text>
                </View>
                <View style={styles.platformMetrics}>
                  {platform && (
                    <Text style={styles.platformMetric}>
                      {row.views == null ? "—" : Number(row.views).toLocaleString()} views
                    </Text>
                  )}
                  <Text style={styles.platformMetric}>
                    {row.impressions == null ? "—" : Number(row.impressions).toLocaleString()} imp.
                  </Text>
                  <Text style={styles.platformMetric}>
                    {row.reach == null ? "—" : Number(row.reach).toLocaleString()} reach
                  </Text>
                  <Text style={styles.platformMetric}>
                    {row.likes == null ? "—" : Number(row.likes).toLocaleString()} likes
                  </Text>
                </View>
              </View>
            ))}
            {!currentData?.byPlatform?.length && (
              <Text style={styles.muted}>No published platform data yet.</Text>
            )}
          </EssentialSection>

          <EssentialSection
            title={platform ? "Top platform content · lifetime engagement" : "Top content"}
          >
            {(currentData?.topPosts || []).map((post: any, index: number) => (
              <View key={`${post.account_id || post.client_id}:${post.id}`} style={styles.topRow}>
                <Text style={styles.rank}>#{index + 1}</Text>
                <View style={styles.topCopy}>
                  <Text style={styles.topTitle} numberOfLines={1}>
                    {post.title}
                  </Text>
                  <Text style={styles.muted}>
                    {post.client_name} · {post.platform}
                    {platform ? (post.from_app ? " · BrandSparQ" : " · Platform") : ""}
                  </Text>
                  {platform && (
                    <Text style={styles.muted}>
                      {post.likes == null ? "—" : Number(post.likes).toLocaleString()} likes ·{" "}
                      {post.comments == null ? "—" : Number(post.comments).toLocaleString()}{" "}
                      comments · {post.shares == null ? "—" : Number(post.shares).toLocaleString()}{" "}
                      shares
                    </Text>
                  )}
                  {!!post.platform_url && (
                    <Button
                      label="View on platform"
                      secondary
                      small
                      onPress={() =>
                        void Linking.openURL(post.platform_url).catch(() =>
                          Alert.alert(
                            "Unable to open link",
                            "Try opening the post on the platform directly.",
                          ),
                        )
                      }
                    />
                  )}
                </View>
                <View style={styles.topMetric}>
                  <Text style={styles.topMetricValue}>
                    {(platform ? (post.views ?? post.impressions) : post.impressions) == null
                      ? "—"
                      : Number(
                          platform ? (post.views ?? post.impressions) : post.impressions,
                        ).toLocaleString()}
                  </Text>
                  <Text style={styles.topMetricLabel}>
                    {platform && post.views != null ? "views" : "impressions"}
                  </Text>
                </View>
              </View>
            ))}
            {!currentData?.topPosts?.length && (
              <Text style={styles.muted}>
                Top content will appear after posts are published and measured.
              </Text>
            )}
          </EssentialSection>
        </>
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  filterLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  chips: { flexDirection: "row", gap: 8, paddingVertical: 5 },
  chip: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSoft, fontWeight: "800" },
  chipTextActive: { color: colors.white },
  rangeRow: { flexDirection: "row", gap: 8 },
  range: {
    flex: 1,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  rangeActive: { backgroundColor: colors.primary },
  rangeText: { color: colors.textSoft, fontWeight: "800" },
  rangeTextActive: { color: colors.white },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: "4%", rowGap: 12 },
  metricCard: { width: "48%", minWidth: 0, padding: 14 },
  value: { color: colors.text, fontSize: 25, fontWeight: "800" },
  label: { color: colors.muted, fontWeight: "700" },
  chart: {
    height: 220,
    minWidth: 620,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingTop: 20,
  },
  barColumn: { width: 54, height: "100%", alignItems: "center", justifyContent: "flex-end" },
  barValue: { color: colors.muted, fontSize: 9, fontWeight: "700" },
  barTrack: {
    height: 150,
    width: 26,
    justifyContent: "flex-end",
    backgroundColor: colors.surface2,
    borderRadius: 8,
    overflow: "hidden",
  },
  bar: { width: "100%", backgroundColor: colors.primary, borderRadius: 8 },
  barLabel: { color: colors.muted, fontSize: 9, marginTop: 5 },
  platformRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  platform: { color: colors.text, fontSize: 16, fontWeight: "900", textTransform: "capitalize" },
  platformMetrics: { flexDirection: "row", flexWrap: "wrap", columnGap: "4%", rowGap: 12 },
  platformMetric: { color: colors.primaryDark, fontWeight: "800", fontSize: 12 },
  muted: { color: colors.muted, lineHeight: 20 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rank: { color: colors.orange, fontSize: 18, fontWeight: "900", width: 34 },
  topCopy: { flex: 1, minWidth: 0 },
  topTitle: { color: colors.text, fontWeight: "900" },
  topMetric: { alignItems: "flex-end" },
  topMetricValue: { color: colors.primary, fontWeight: "900" },
  topMetricLabel: { color: colors.muted, fontSize: 9 },
  healthRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  healthCopy: { flex: 1 },
  error: { color: colors.danger, lineHeight: 19 },
});

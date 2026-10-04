import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
  const [data, setData] = useState<any>();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("all");
  const [days, setDays] = useState(30);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [analytics, clientRows] = await Promise.all([
        api.getAnalyticsOverview(clientId === "all" ? undefined : clientId, days),
        api.getClients(),
      ]);
      setData(analytics.data);
      setClients(clientRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load analytics.");
    }
  }

  useEffect(() => {
    void load();
  }, [clientId, days]);

  async function sync() {
    setSyncing(true);
    try {
      const accounts = (await api.getSocialAccounts(clientId === "all" ? undefined : clientId))
        .data;
      if (clientId === "all") {
        await api.syncAnalytics();
      } else {
        for (const account of accounts) await api.syncAnalytics(account.id);
      }
      await load();
    } catch (e) {
      Alert.alert("Analytics sync failed", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSyncing(false);
    }
  }

  const overview = data?.overview || {};
  const history = data?.history || [];
  const maxImpressions = useMemo(
    () => Math.max(1, ...history.map((row: any) => Number(row.impressions || 0))),
    [history],
  );

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Performance"
        title="Analytics"
        subtitle="Track performance over time, compare platforms, find top posts, and verify provider sync health."
        action={
          <Button
            label={syncing ? "Syncing…" : "Sync now"}
            small
            onPress={syncing ? undefined : sync}
          />
        }
      />

      <Card subtle>
        <Text style={styles.filterLabel}>Client</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chips}>
            <Pressable
              onPress={() => setClientId("all")}
              style={[styles.chip, clientId === "all" && styles.chipActive]}
            >
              <Text style={[styles.chipText, clientId === "all" && styles.chipTextActive]}>
                All clients
              </Text>
            </Pressable>
            {clients.map((client) => (
              <Pressable
                key={client.id}
                onPress={() => setClientId(client.id)}
                style={[styles.chip, clientId === client.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, clientId === client.id && styles.chipTextActive]}>
                  {client.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <View style={styles.rangeRow}>
          {[7, 30, 90].map((value) => (
            <Pressable
              key={value}
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

      {!!error && (
        <Card subtle>
          <Text style={styles.error}>{error}</Text>
        </Card>
      )}

      <View style={styles.grid}>
        {metrics.map(([label, key]) => (
          <Card key={key} style={styles.metricCard}>
            <Text style={styles.value}>{Number(overview[key] || 0).toLocaleString()}</Text>
            <Text style={styles.label}>{label}</Text>
          </Card>
        ))}
      </View>

      <Card>
        <SectionTitle
          title="Performance trend"
          subtitle={`Latest captured totals across the last ${days} days.`}
        />
        {history.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chart}>
              {history.map((row: any) => (
                <View key={row.day} style={styles.barColumn}>
                  <Text style={styles.barValue}>
                    {Number(row.impressions || 0).toLocaleString()}
                  </Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height:
                            `${Math.max(5, (Number(row.impressions || 0) / maxImpressions) * 100)}%` as any,
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
            Trend data will appear after analytics snapshots are captured.
          </Text>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Platform performance"
          subtitle="Current lifetime metrics from the latest provider measurements."
        />
        {(data?.byPlatform || []).map((row: any) => (
          <View key={row.platform} style={styles.platformRow}>
            <View>
              <Text style={styles.platform}>{row.platform}</Text>
              <Text style={styles.muted}>{row.posts} published</Text>
            </View>
            <View style={styles.platformMetrics}>
              <Text style={styles.platformMetric}>
                {Number(row.impressions || 0).toLocaleString()} imp.
              </Text>
              <Text style={styles.platformMetric}>
                {Number(row.reach || 0).toLocaleString()} reach
              </Text>
              <Text style={styles.platformMetric}>
                {Number(row.likes || 0).toLocaleString()} likes
              </Text>
            </View>
          </View>
        ))}
        {!data?.byPlatform?.length && (
          <Text style={styles.muted}>No published platform data yet.</Text>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Top content"
          subtitle="Ranked by meaningful engagement, then impressions."
        />
        {(data?.topPosts || []).map((post: any, index: number) => (
          <View key={post.id} style={styles.topRow}>
            <Text style={styles.rank}>#{index + 1}</Text>
            <View style={styles.topCopy}>
              <Text style={styles.topTitle} numberOfLines={1}>
                {post.title}
              </Text>
              <Text style={styles.muted}>
                {post.client_name} · {post.platform}
              </Text>
            </View>
            <View style={styles.topMetric}>
              <Text style={styles.topMetricValue}>
                {Number(post.impressions || 0).toLocaleString()}
              </Text>
              <Text style={styles.topMetricLabel}>impressions</Text>
            </View>
          </View>
        ))}
        {!data?.topPosts?.length && (
          <Text style={styles.muted}>
            Top content will appear after posts are published and measured.
          </Text>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Sync health"
          subtitle="Recent provider analytics refreshes and errors."
        />
        {(data?.syncHealth || []).slice(0, 8).map((run: any) => (
          <View key={run.id} style={styles.healthRow}>
            <View style={styles.healthCopy}>
              <Text style={styles.topTitle}>
                {run.account_name || run.platform || "Social account"}
              </Text>
              <Text style={styles.muted}>
                {run.client_name || "Client"} · {new Date(run.started_at).toLocaleString()}
              </Text>
              {!!run.error_message && <Text style={styles.error}>{run.error_message}</Text>}
            </View>
            <StatusBadge label={run.status} />
          </View>
        ))}
        {!data?.syncHealth?.length && <Text style={styles.muted}>No analytics sync runs yet.</Text>}
      </Card>
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
  rangeRow: { flexDirection: "row", gap: 8, marginTop: spacing.sm },
  range: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  rangeActive: { backgroundColor: colors.primary },
  rangeText: { color: colors.textSoft, fontWeight: "800" },
  rangeTextActive: { color: colors.white },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  metricCard: { flexGrow: 1, flexBasis: 180, maxWidth: "100%" },
  value: { color: colors.text, fontSize: 30, fontWeight: "900" },
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
  platformMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
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

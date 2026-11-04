import { useAuth } from "@/auth/context";
import { Ionicons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View, Pressable } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";

type Dashboard = Awaited<ReturnType<typeof api.getDashboard>>["data"];
export default function HomeScreen() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDashboard((await api.getDashboard()).data);
    } catch (err) {
      setDashboard(null);
      setError(err instanceof Error ? err.message : "Unable to load your workspace.");
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const next = dashboard?.nextPost;
  return (
    <PageScroll refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <PageHeader
        title="Your workspace"
        subtitle={`${user?.name ? `Welcome back, ${user.name.split(" ")[0]}.` : "Welcome back."} Here’s your workspace.`}
      />
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading workspace" color={colors.primary} />
      ) : error ? (
        <Card>
          <Text style={styles.title}>Workspace unavailable</Text>
          <Text style={styles.body}>{error}</Text>
          <Button label="Try again" onPress={load} />
        </Card>
      ) : dashboard ? (
        <>
          <Text style={styles.body}>
            Today in {dashboard.day?.timezone || "workspace time zone"}
          </Text>
          <View style={styles.metrics}>
            {[
              [dashboard.needsReview, "Awaiting\nreview"],
              [dashboard.scheduled, "Scheduled\nposts"],
              [dashboard.activeClients ?? "—", "Active\nclients"],
            ].map(([value, label]) => (
              <Card key={label} style={styles.metric}>
                <Text style={styles.number}>{value}</Text>
                <Text style={styles.metricLabel}>{label}</Text>
              </Card>
            ))}
          </View>
        </>
      ) : null}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.title}>
          Quick access
        </Text>
      </View>
      <View style={styles.actions}>
        {(
          [
            { href: "/review", label: "Review content", title: "Review", icon: "list-outline" },
            {
              href: "/clients",
              label: "Client workspaces",
              title: "Clients",
              icon: "people-outline",
            },
            {
              href: "/analytics",
              label: "Analytics",
              title: "Analytics",
              icon: "analytics-outline",
            },
          ] as const
        ).map((item) => (
          <Link key={item.href} href={item.href} asChild>
            <Pressable accessibilityLabel={item.label} style={styles.action}>
              <Ionicons name={item.icon} size={24} color={colors.primary} />
              <Text style={styles.actionText}>{item.title}</Text>
            </Pressable>
          </Link>
        ))}
      </View>
      {dashboard && (
        <>
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.title}>
              Upcoming content
            </Text>
            <Link href="/calendar" style={styles.link}>
              View calendar →
            </Link>
          </View>
          <Card>
            {next ? (
              <>
                <StatusBadge label={next.status} />
                <Text style={styles.title}>{next.title || next.client_name}</Text>
                <Text style={styles.body}>
                  {next.client_name} · {next.platform}
                </Text>
                <Text style={styles.body}>
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  {" · "}
                  {next.scheduled_publish_at
                    ? new Date(next.scheduled_publish_at).toLocaleString()
                    : "Schedule pending"}
                </Text>
                <Link href={`/posts/${next.id}`} style={styles.link}>
                  View post →
                </Link>
              </>
            ) : (
              <>
                <Text style={styles.title}>Your calendar is clear</Text>
                <Text style={styles.body}>Approved and scheduled posts will appear here.</Text>
              </>
            )}
          </Card>

          {!!dashboard.failed && (
            <Card subtle>
              <Text style={styles.title}>{dashboard.failed} posts need attention</Text>
              <Link href={user?.role === "owner" ? "/system" : "/calendar"} style={styles.link}>
                Open recovery tools →
              </Link>
            </Card>
          )}
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.title}>
              Recent activity
            </Text>
          </View>
          <Card>
            {dashboard.recentActivity?.length ? (
              dashboard.recentActivity.map((activity) => (
                <View key={activity.id} style={styles.activityRow}>
                  <View style={styles.activityDot} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.activityTitle}>{activity.title}</Text>
                    <Text numberOfLines={2} style={styles.body}>
                      {activity.body}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.body}>Updates from your workspace will appear here.</Text>
            )}
          </Card>
        </>
      )}
    </PageScroll>
  );
}
const styles = StyleSheet.create({
  activityRow: { flexDirection: "row", gap: 12, paddingVertical: 8 },
  activityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 7,
  },
  activityTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  actionText: { color: colors.text, fontSize: 13, fontWeight: "700", textAlign: "center" },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  hero: { backgroundColor: colors.primary, padding: spacing.lg, borderRadius: radius.lg, gap: 14 },
  heroEyebrow: { color: colors.white, fontSize: 12, fontWeight: "700", letterSpacing: 1.5 },
  heroTitle: { color: colors.white, fontSize: 28, fontWeight: "900", lineHeight: 34 },
  heroBody: { color: colors.white, fontSize: 15, lineHeight: 23 },
  heroButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: "center",
  },
  heroButtonText: { color: colors.text, fontWeight: "800", fontSize: 15 },
  metrics: { flexDirection: "row", flexWrap: "nowrap", gap: 8 },
  metric: { alignItems: "center", flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 10 },
  number: { color: colors.text, fontSize: 30, fontWeight: "900" },
  section: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  link: { color: colors.primary, fontWeight: "700", paddingVertical: 14, minHeight: 48 },
  metricLabel: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18 },
  actions: { flexDirection: "row", gap: 8 },
  action: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 12,
    color: colors.primary,
    fontWeight: "800",
    minHeight: 86,
  },
});

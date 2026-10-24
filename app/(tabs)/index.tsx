import { useCapabilities } from "@/auth/capabilities";
import { useAuth } from "@/auth/context";
import { Link } from "expo-router";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";

type Dashboard = Awaited<ReturnType<typeof api.getDashboard>>["data"];
export default function HomeScreen() {
  const can = useCapabilities();
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
        eyebrow={user?.name ? `Welcome, ${user.name.split(" ")[0]}` : "Welcome back"}
        title="Your workspace"
        subtitle="Your brands, content, and next steps in one place."
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
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>YOUR NEXT MOVE</Text>
            <Text accessibilityRole="header" style={styles.heroTitle}>
              {dashboard.needsReview
                ? `${dashboard.needsReview} post${dashboard.needsReview === 1 ? "" : "s"} ready for review`
                : "Ready for your next idea?"}
            </Text>
            <Text style={styles.heroBody}>
              {dashboard.needsReview
                ? "Give your content a final look before it goes live."
                : "Create branded content or explore your client workspaces."}
            </Text>
            <Link
              href={dashboard.needsReview ? "/review" : can("generate") ? "/create" : "/clients"}
              asChild
            >
              <Pressable accessibilityRole="button" style={styles.heroButton}>
                <Text style={styles.heroButtonText}>
                  {dashboard.needsReview
                    ? "Review posts →"
                    : can("generate")
                      ? "Create content →"
                      : "Open clients →"}
                </Text>
              </Pressable>
            </Link>
          </View>
          <View style={styles.metrics}>
            {[
              [dashboard.scheduled, "Scheduled"],
              [dashboard.publishingToday, "Publishing today"],
              [dashboard.failed, "Needs attention"],
            ].map(([value, label]) => (
              <Card key={label} style={styles.metric}>
                <Text style={styles.number}>{value}</Text>
                <Text style={styles.body}>{label}</Text>
              </Card>
            ))}
          </View>
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.title}>
              Coming up
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
        </>
      ) : null}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.title}>
          Quick access
        </Text>
      </View>
      <View style={styles.actions}>
        <Link href="/clients" style={styles.action}>
          Client workspaces →
        </Link>
        <Link href="/review" style={styles.action}>
          Review content →
        </Link>
        {can("generate") && (
          <Link href="/create" style={styles.action}>
            Create campaign →
          </Link>
        )}
      </View>
    </PageScroll>
  );
}
const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 20, fontWeight: "800" },
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
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metric: { flexGrow: 1, flexBasis: 120, minWidth: 0, padding: 16 },
  number: { color: colors.text, fontSize: 30, fontWeight: "900" },
  section: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  link: { color: colors.primary, fontWeight: "700", paddingVertical: 14, minHeight: 48 },
  actions: { gap: 10 },
  action: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    color: colors.primary,
    fontWeight: "800",
    minHeight: 52,
  },
});

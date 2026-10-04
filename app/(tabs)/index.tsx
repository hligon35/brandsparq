import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { BrandLogo } from "@/components/brand";
import { Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";

type Dashboard = {
  needsReview: number;
  scheduled: number;
  publishingToday: number;
  failed: number;
  nextPost: any | null;
};

export default function HomeScreen() {
  const { compact, wide } = useResponsive();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await api.getDashboard();
      setDashboard(result.data);
    } catch (err) {
      setDashboard(null);
      setError(err instanceof Error ? err.message : "Unable to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const stats = [
    { value: dashboard?.needsReview ?? 0, label: "Needs review", tone: colors.orange },
    { value: dashboard?.scheduled ?? 0, label: "Scheduled", tone: colors.primary },
    { value: dashboard?.publishingToday ?? 0, label: "Publishing today", tone: colors.cyan },
    { value: dashboard?.failed ?? 0, label: "Needs attention", tone: colors.warning },
  ];

  const next = dashboard?.nextPost;

  return (
    <PageScroll contentStyle={styles.page}>
      {compact && (
        <View style={styles.mobileLogo}>
          <BrandLogo compact />
        </View>
      )}

      <View style={[styles.hero, wide && styles.heroWide]}>
        <View style={styles.heroCopy}>
          <PageHeader
            eyebrow="Create. Caption. Post."
            title="Marketing moves faster with a system."
            subtitle="Turn raw images into branded social content, review it, place approved posts on the calendar, and publish from one workspace."
          />
          <View style={styles.quickActions}>
            <Link href="/create" asChild>
              <Pressable style={styles.primaryAction}>
                <Text style={styles.primaryActionText}>Create campaign</Text>
              </Pressable>
            </Link>
            <Link href="/review" asChild>
              <Pressable style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>Review content</Text>
              </Pressable>
            </Link>
          </View>
        </View>

        <Card style={styles.upcomingCard}>
          <View style={styles.upcomingAccent} />
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : error ? (
            <>
              <Text style={styles.upcomingLabel}>Dashboard unavailable</Text>
              <Text style={styles.upcomingBody}>{error}</Text>
              <Pressable onPress={load}>
                <Text style={styles.retry}>Try again</Text>
              </Pressable>
            </>
          ) : next ? (
            <>
              <StatusBadge label={next.status} />
              <Text style={styles.upcomingLabel}>Next up</Text>
              <Text style={styles.upcomingTitle}>
                {next.client_name} · {String(next.platform).toUpperCase()}
              </Text>
              <Text style={styles.upcomingTime}>
                {new Date(next.scheduled_publish_at).toLocaleString()}
              </Text>
              <Text style={styles.upcomingBody}>
                This is the next approved post currently queued on your marketing calendar.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.upcomingLabel}>Next up</Text>
              <Text style={styles.upcomingTitle}>Calendar is clear</Text>
              <Text style={styles.upcomingBody}>
                Approve content to place your next post on the calendar.
              </Text>
            </>
          )}
        </Card>
      </View>

      <View style={styles.statsGrid}>
        {stats.map((stat) => (
          <Card key={stat.label} style={styles.statCard}>
            <View style={[styles.statDot, { backgroundColor: stat.tone }]} />
            <Text style={styles.metric}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </Card>
        ))}
      </View>

      <View style={[styles.workflow, !compact && styles.workflowWide]}>
        {[
          ["01", "Create", "Upload images and let BrandSparQ shape the campaign."],
          ["02", "Caption", "Generate platform-specific copy and proposed posting slots."],
          ["03", "Post", "Approve, schedule, and publish with final control."],
        ].map(([step, title, body]) => (
          <Card key={step} subtle style={styles.workflowCard}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepText}>{step}</Text>
            </View>
            <Text style={styles.workflowTitle}>{title}</Text>
            <Text style={styles.workflowBody}>{body}</Text>
          </Card>
        ))}
      </View>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing.lg },
  mobileLogo: { marginBottom: 4 },
  hero: { gap: spacing.lg },
  heroWide: { flexDirection: "row", alignItems: "stretch" },
  heroCopy: { flex: 1.35, gap: spacing.lg, justifyContent: "center" },
  quickActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  primaryAction: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  primaryActionText: { color: colors.white, fontWeight: "800" },
  secondaryAction: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  secondaryActionText: { color: colors.text, fontWeight: "800" },
  upcomingCard: { flex: 0.75, minHeight: 230, overflow: "hidden", justifyContent: "center" },
  upcomingAccent: {
    position: "absolute",
    width: 115,
    height: 115,
    borderRadius: 58,
    backgroundColor: "#E8FBFD",
    right: -25,
    top: -28,
  },
  upcomingLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  upcomingTitle: { color: colors.text, fontSize: 23, fontWeight: "900" },
  upcomingTime: { color: colors.primary, fontSize: 16, fontWeight: "800" },
  upcomingBody: { color: colors.muted, lineHeight: 21 },
  retry: { color: colors.primary, fontWeight: "800" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  statCard: { flexGrow: 1, flexBasis: 180, minHeight: 140, justifyContent: "center" },
  statDot: { width: 10, height: 10, borderRadius: 5 },
  metric: { color: colors.text, fontSize: 34, lineHeight: 39, fontWeight: "900" },
  statLabel: { color: colors.muted, fontWeight: "700" },
  workflow: { gap: spacing.md },
  workflowWide: { flexDirection: "row" },
  workflowCard: { flex: 1, minHeight: 170 },
  stepBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#EAF3FF",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { color: colors.primary, fontWeight: "900" },
  workflowTitle: { color: colors.text, fontSize: 20, fontWeight: "900" },
  workflowBody: { color: colors.muted, lineHeight: 21 },
});

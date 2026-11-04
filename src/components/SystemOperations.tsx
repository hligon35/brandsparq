import { WebhookJobs } from "@/components/WebhookJobs";
import { PublishReconciliation } from "@/components/PublishReconciliation";
import { IconButton } from "@/components/icon-button";
import { PilotControls } from "@/components/PilotControls";
import { Alert } from "@/components/feedback";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, StatusBadge } from "@/components/ui";
import { EssentialSection } from "@/components/essential";
import { colors, radius, spacing } from "@/theme/tokens";

function count(rows: any[], status: string) {
  return Number(rows?.find((row) => row.status === status)?.count || 0);
}

export function SystemOperations() {
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(false);
  const [certification, setCertification] = useState<any>();
  const [certifying, setCertifying] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setData((await api.getSystemOverview()).data);
    } catch (e) {
      Alert.alert("Unable to load system health", e instanceof Error ? e.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function certify() {
    setCertifying(true);
    try {
      const result = await api.runLaunchCertification();
      setCertification(result.data);
      if (result.data.status === "blocked") {
        Alert.alert(
          "Launch blocked",
          result.data.blockers.join("\n") || "Resolve the failed launch checks.",
        );
      } else {
        Alert.alert(
          result.data.status === "ready" ? "Launch checks passed" : "Ready with warnings",
          result.data.warnings.join("\n") || "BrandSparQ passed all automated launch checks.",
        );
      }
    } catch (e) {
      Alert.alert("Certification failed", e instanceof Error ? e.message : "Try again.");
    } finally {
      setCertifying(false);
    }
  }

  async function recover() {
    try {
      const result = await api.recoverSystemWork();
      Alert.alert(
        "Recovery complete",
        "Publishing recovered: " +
          result.data.publishRecovered +
          "\nGeneration recovered: " +
          result.data.generationRecovered +
          "\nGraphics recovered: " +
          (result.data.graphicsRecovered || 0),
      );
      await load();
    } catch (e) {
      Alert.alert("Recovery failed", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function retry(postId: string) {
    try {
      await api.retryFailedPost(postId);
      await load();
    } catch (e) {
      Alert.alert("Retry failed", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function resolve(id: string) {
    try {
      await api.resolveSystemEvent(id);
      await load();
    } catch (e) {
      Alert.alert("Unable to resolve", e instanceof Error ? e.message : "Try again.");
    }
  }

  const health = data?.health;
  const checked = health?.timestamp
    ? "Checked " + new Date(health.timestamp).toLocaleString()
    : "Live Worker dependencies";
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.inline}>
        <Text accessibilityRole="header" style={styles.title}>
          Workspace operations
        </Text>
        <IconButton
          label="Refresh system health"
          busy={loading}
          onPress={loading ? undefined : load}
        />
      </View>
      <View style={styles.actions}>
        <Button
          label={certifying ? "Checking…" : "Run launch check"}
          small
          secondary
          onPress={certifying ? undefined : certify}
        />
        <Button label="Recover stuck work" small onPress={recover} />
      </View>

      <EssentialSection title="Publishing controls" defaultOpen={false}>
        <PilotControls />
      </EssentialSection>

      <View style={styles.grid}>
        <Card style={styles.metric}>
          <Text style={[styles.big, health?.ok ? styles.good : styles.bad]}>
            {!data ? "Checking…" : health?.ok ? "Healthy" : "Needs attention"}
          </Text>
          <Text style={styles.muted}>Production readiness</Text>
        </Card>
        <Card style={styles.metric}>
          <View style={styles.statTop}>
            <Text style={styles.big}>{count(data?.publishJobs || [], "failed")}</Text>
            <Text style={styles.days}>7 days</Text>
          </View>
          <Text style={styles.muted}>Failed publish jobs</Text>
        </Card>
        <Card style={styles.metric}>
          <View style={styles.statTop}>
            <Text style={styles.big}>{count(data?.generationJobs || [], "failed")}</Text>
            <Text style={styles.days}>7 days</Text>
          </View>
          <Text style={styles.muted}>Failed generation jobs</Text>
        </Card>
        <Card style={styles.metric}>
          <Text style={styles.big}>{data?.events?.length || 0}</Text>
          <Text style={styles.muted}>Active system events</Text>
        </Card>
      </View>

      <EssentialSection title="Launch certification" defaultOpen={false}>
        {certification ? (
          <>
            <View style={styles.inline}>
              <StatusBadge label={certification.status} />
              <Text style={styles.muted}>
                Checked {new Date(certification.createdAt).toLocaleString()}
              </Text>
            </View>
            {!!certification.blockers?.length && (
              <View style={styles.certGroup}>
                <Text style={styles.error}>Launch blockers</Text>
                {certification.blockers.map((item: string, index: number) => (
                  <Text key={index} style={styles.muted}>
                    • {item}
                  </Text>
                ))}
              </View>
            )}
            {!!certification.warnings?.length && (
              <View style={styles.certGroup}>
                <Text style={styles.warning}>Warnings</Text>
                {certification.warnings.map((item: string, index: number) => (
                  <Text key={index} style={styles.muted}>
                    • {item}
                  </Text>
                ))}
              </View>
            )}
            {!certification.blockers?.length && !certification.warnings?.length && (
              <Text style={styles.goodText}>All automated launch checks passed.</Text>
            )}
          </>
        ) : (
          <Text style={styles.muted}>
            Run the launch check after applying the latest migrations and production secrets.
          </Text>
        )}
      </EssentialSection>

      <EssentialSection title="Readiness checks" summary={checked}>
        {(health?.checks || []).map((check: any) => (
          <View key={check.name} style={styles.row}>
            <View style={styles.copy}>
              <Text style={styles.title}>{check.name}</Text>
              <Text style={styles.muted}>{check.detail}</Text>
            </View>
            <StatusBadge label={check.ok ? "healthy" : "failed"} />
          </View>
        ))}
      </EssentialSection>

      <EssentialSection title="Active incidents">
        {(data?.events || []).map((event: any) => (
          <View key={event.id} style={styles.incident}>
            <View style={styles.copy}>
              <View style={styles.inline}>
                <StatusBadge label={event.severity} />
                <Text style={styles.title}>{event.event_type.replaceAll("_", " ")}</Text>
              </View>
              <Text style={styles.muted}>{event.message}</Text>
              <Text style={styles.time}>{new Date(event.created_at).toLocaleString()}</Text>
            </View>
            <Pressable onPress={() => resolve(event.id)}>
              <Text style={styles.link}>Resolve</Text>
            </Pressable>
          </View>
        ))}
        {!data?.events?.length && <Text style={styles.muted}>No active incidents.</Text>}
      </EssentialSection>

      <EssentialSection title="Failed posts">
        {(data?.failedPosts || []).map((post: any) => (
          <View
            key={post.id}
            style={[styles.incident, { flexDirection: "column", alignItems: "stretch" }]}
          >
            <View style={styles.copy}>
              <Text style={styles.title}>{post.title}</Text>
              <Text style={styles.muted}>
                {post.client_name} · {post.platform} · {post.failure_code || "publish failure"}
              </Text>
              {!!post.failure_message && <Text style={styles.error}>{post.failure_message}</Text>}
            </View>
            {post.failure_code === "PUBLISH_OUTCOME_UNKNOWN" ? (
              <PublishReconciliation post={post} onResolved={load} />
            ) : (
              <Button label="Retry" small secondary onPress={() => retry(post.id)} />
            )}
          </View>
        ))}
        {!data?.failedPosts?.length && (
          <Text style={styles.muted}>No failed posts need recovery.</Text>
        )}
      </EssentialSection>

      <EssentialSection title="Verified publishing outcomes" defaultOpen={false}>
        {(data?.reconciliations || []).map((item: any) => (
          <View key={item.id} style={styles.incident}>
            <View style={styles.copy}>
              <Text style={styles.title}>
                {item.title || item.entity_id} · {item.next_state.replaceAll("_", " ")}
              </Text>
              <Text style={styles.muted}>{item.metadata?.evidence}</Text>
              {!!item.metadata?.providerPostId && (
                <Text style={styles.muted}>Provider ID: {item.metadata.providerPostId}</Text>
              )}
              <Text style={styles.time}>
                {item.actor_email} · {new Date(item.created_at).toLocaleString()}
              </Text>
            </View>
          </View>
        ))}
        {!data?.reconciliations?.length && (
          <Text style={styles.muted}>No publishing outcomes have been reconciled.</Text>
        )}
      </EssentialSection>

      <EssentialSection title="Queue activity" defaultOpen={false}>
        <Text style={styles.group}>Publishing</Text>
        <View style={styles.pills}>
          {(data?.publishJobs || []).map((row: any) => (
            <View key={row.status} style={styles.pill}>
              <Text style={styles.pillText}>
                {row.status}: {row.count}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.group}>Generation</Text>
        <View style={styles.pills}>
          {(data?.generationJobs || []).map((row: any) => (
            <View key={row.status} style={styles.pill}>
              <Text style={styles.pillText}>
                {row.status}: {row.count}
              </Text>
            </View>
          ))}
        </View>
      </EssentialSection>
      <WebhookJobs />
    </View>
  );
}

const styles = StyleSheet.create({
  statTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  days: { color: colors.muted, fontSize: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  metric: { flexGrow: 1, flexBasis: 130, minWidth: 0, padding: 12 },
  big: { color: colors.text, fontSize: 24, fontWeight: "700" },
  good: { color: colors.success },
  bad: { color: colors.danger },
  muted: { color: colors.muted, lineHeight: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  incident: {
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  copy: { flex: 1, gap: 4 },
  title: { color: colors.text, fontWeight: "700", textTransform: "capitalize" },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  time: { color: colors.muted, fontSize: 11 },
  link: { color: colors.primary, fontWeight: "700" },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  group: { color: colors.textSoft, fontWeight: "700", marginTop: spacing.sm },
  certGroup: { gap: 4, marginTop: spacing.sm },
  warning: { color: colors.warning, fontWeight: "700" },
  goodText: { color: colors.success, fontWeight: "800" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  pillText: { color: colors.textSoft, fontWeight: "800", textTransform: "capitalize" },
});

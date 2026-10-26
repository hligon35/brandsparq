import { useCapabilities } from "@/auth/capabilities";
import { Alert } from "@/components/feedback";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, spacing } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

export default function PublishDecisionScreen() {
  const can = useCapabilities();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const [post, setPost] = useState<MarketingPost>();
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState("");
  const { wide } = useResponsive();

  async function load() {
    if (!postId) return;
    setLoadError("");
    try {
      const [nextPost, clients] = await Promise.all([api.getPost(postId), api.getClients()]);
      setTimezone(
        clients.find((client) => client.id === nextPost.clientId)?.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      setPost(nextPost);
    } catch (error) {
      setPost(undefined);
      setLoadError(error instanceof Error ? error.message : "Unable to load post.");
    }
  }

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [postId]),
  );

  if (!post) {
    return (
      <PageScroll>
        <Card subtle>
          <Text style={styles.title}>{loadError ? "Post unavailable" : "Loading post…"}</Text>
          {!!loadError && <Text style={styles.sub}>{loadError}</Text>}
          {!!loadError && (
            <Text onPress={load} style={styles.retry}>
              Try again
            </Text>
          )}
        </Card>
      </PageScroll>
    );
  }

  async function keep() {
    setWorking(true);
    try {
      await api.keepSchedule(post!.id);
      Alert.alert("Schedule kept", "BrandSparQ will publish at the scheduled time.");
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: "/calendar", params: { clientId: post!.clientId } });
    } catch (error) {
      Alert.alert("Unable to update", error instanceof Error ? error.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  async function publishNow() {
    setWorking(true);
    try {
      await api.publishNow(post!.id);
      Alert.alert("Queued to publish", "BrandSparQ has started the publishing job.");
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: "/calendar", params: { clientId: post!.clientId } });
    } catch (error) {
      Alert.alert("Unable to publish", error instanceof Error ? error.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Final control"
        title="Ready to publish?"
        subtitle={`${post.clientName || "Client"} · ${post.platform.toUpperCase()}`}
        action={<StatusBadge label={post.status} />}
      />

      <Card style={styles.scheduleCard}>
        <Text style={styles.label}>Scheduled</Text>
        <Text style={styles.time}>
          {post.scheduledPublishAt
            ? new Date(post.scheduledPublishAt).toLocaleString(undefined, { timeZone: timezone })
            : "No time selected"}
        </Text>
        <Text accessibilityLabel="Publishing time zone" style={styles.sub}>
          {timezone}
        </Text>
        <Text style={styles.sub}>{post.title}</Text>
      </Card>

      <View style={[styles.actions, wide && styles.actionsWide]}>
        <View style={styles.action}>
          <Button
            label={working ? "Updating…" : "Keep schedule"}
            onPress={working || !can("calendar_manage", post.clientId) ? undefined : keep}
          />
        </View>
        <View style={styles.action}>
          <Button
            label="Reschedule"
            secondary
            onPress={
              can("calendar_manage", post.clientId)
                ? () => router.push(`/posts/${post.id}/reschedule`)
                : undefined
            }
          />
        </View>
        <View style={styles.action}>
          <Button
            label="Publish now"
            secondary
            onPress={working || !can("publish", post.clientId) ? undefined : publishNow}
          />
        </View>
      </View>

      <Card subtle>
        <Text style={styles.controlTitle}>You still have control.</Text>
        <Text style={styles.sub}>
          Keeping the schedule leaves the approved calendar intact. Rescheduling moves the post.
          Publish Now sends it to the publishing queue immediately.
        </Text>
      </Card>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900",
  },
  scheduleCard: {
    minHeight: 190,
    justifyContent: "center",
    backgroundColor: "#F7FBFF",
  },
  label: {
    color: colors.primary,
    fontSize: 12,
    textTransform: "uppercase",
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  time: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  sub: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    gap: spacing.sm,
  },
  actionsWide: {
    flexDirection: "row",
  },
  action: {
    flex: 1,
  },
  controlTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  retry: {
    color: colors.primary,
    fontWeight: "800",
  },
});

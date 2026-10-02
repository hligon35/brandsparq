import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import {
  Button,
  Card,
  PageHeader,
  PageScroll,
  StatusBadge,
} from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

export default function PublishDecisionScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const [post, setPost] = useState<MarketingPost>();
  const [working, setWorking] = useState(false);
  const { wide } = useResponsive();

  useEffect(() => {
    if (postId) api.getPost(postId).then(setPost).catch(() => {});
  }, [postId]);

  if (!post) {
    return (
      <PageScroll>
        <Text style={styles.title}>Loading post…</Text>
      </PageScroll>
    );
  }

  async function keep() {
    setWorking(true);
    try {
      await api.keepSchedule(post.id);
      Alert.alert(
        "Schedule kept",
        "BrandSparQ will publish at the scheduled time."
      );
      router.back();
    } catch (error) {
      Alert.alert(
        "Unable to update",
        error instanceof Error ? error.message : "Try again."
      );
    } finally {
      setWorking(false);
    }
  }

  async function publishNow() {
    setWorking(true);
    try {
      await api.publishNow(post.id);
      Alert.alert(
        "Queued to publish",
        "BrandSparQ has started the publishing job."
      );
      router.back();
    } catch (error) {
      Alert.alert(
        "Unable to publish",
        error instanceof Error ? error.message : "Try again."
      );
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
            ? new Date(post.scheduledPublishAt).toLocaleString()
            : "No time selected"}
        </Text>
        <Text style={styles.sub}>{post.title}</Text>
      </Card>

      <View style={[styles.actions, wide && styles.actionsWide]}>
        <View style={styles.action}>
          <Button
            label={working ? "Updating…" : "Keep schedule"}
            onPress={working ? undefined : keep}
          />
        </View>
        <View style={styles.action}>
          <Button
            label="Reschedule"
            secondary
            onPress={() =>
              router.push(`/posts/${post.id}/reschedule`)
            }
          />
        </View>
        <View style={styles.action}>
          <Button
            label="Publish now"
            secondary
            onPress={working ? undefined : publishNow}
          />
        </View>
      </View>

      <Card subtle>
        <Text style={styles.controlTitle}>You still have control.</Text>
        <Text style={styles.sub}>
          Keeping the schedule leaves the approved calendar intact.
          Rescheduling moves the post. Publish Now sends it to the
          publishing queue immediately.
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
});

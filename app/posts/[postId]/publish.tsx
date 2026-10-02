import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { api } from "@/api/client";
import { Button, Card, Screen, StatusBadge } from "@/components/ui";
import { colors } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

export default function PublishDecisionScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const [post, setPost] = useState<MarketingPost>();
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (postId) api.getPost(postId).then(setPost).catch(() => {});
  }, [postId]);

  if (!post) {
    return (
      <Screen>
        <Text style={styles.title}>Loading post…</Text>
      </Screen>
    );
  }

  async function keep() {
    setWorking(true);
    try {
      await api.keepSchedule(post.id);
      Alert.alert("Schedule kept", "BrandSparQ will publish at the scheduled time.");
      router.back();
    } catch (error) {
      Alert.alert("Unable to update", error instanceof Error ? error.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  async function publishNow() {
    setWorking(true);
    try {
      await api.publishNow(post.id);
      Alert.alert("Queued to publish", "BrandSparQ has started the publishing job.");
      router.back();
    } catch (error) {
      Alert.alert("Unable to publish", error instanceof Error ? error.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Screen>
      <StatusBadge label={post.status} />
      <Text style={styles.title}>Ready to publish?</Text>
      <Text style={styles.sub}>{post.clientName} · {post.platform.toUpperCase()}</Text>

      <Card>
        <Text style={styles.label}>Scheduled</Text>
        <Text style={styles.time}>
          {post.scheduledPublishAt
            ? new Date(post.scheduledPublishAt).toLocaleString()
            : "No time selected"}
        </Text>
        <Text style={styles.sub}>{post.title}</Text>
      </Card>

      <Button label={working ? "Updating…" : "Keep schedule"} onPress={working ? undefined : keep} />
      <Button
        label="Reschedule"
        secondary
        onPress={() => router.push(`/posts/${post.id}/reschedule`)}
      />
      <Button label="Publish now" secondary onPress={working ? undefined : publishNow} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase", fontWeight: "700" },
  time: { color: colors.text, fontSize: 20, fontWeight: "800" },
});

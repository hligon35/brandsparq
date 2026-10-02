import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { api } from "@/api/client";
import { Button, Card, Screen, StatusBadge } from "@/components/ui";
import { clients, posts as demoPosts } from "@/data/demo";
import { colors } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

export default function PostReviewScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const [post, setPost] = useState<MarketingPost | undefined>(
    demoPosts.find((item) => item.id === postId)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!postId) return;
    api.getPost(postId).then(setPost).catch(() => {});
  }, [postId]);

  if (!post) {
    return (
      <Screen>
        <Text style={styles.title}>Post not found</Text>
      </Screen>
    );
  }

  const demoClient = clients.find((item) => item.id === post.clientId);

  async function approve() {
    setSaving(true);
    try {
      await api.approvePost(post.id);
      Alert.alert("Approved", "This post is now on the marketing calendar.");
      router.back();
    } catch (error) {
      Alert.alert("Approval failed", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <StatusBadge label={post.status} />
      <Text style={styles.title}>
        {post.clientName || demoClient?.name || "Client"}
      </Text>
      <Text style={styles.platform}>{post.platform.toUpperCase()}</Text>

      <Card>
        <Text style={styles.placeholder}>
          {post.imageUrl ? "GRAPHIC READY" : "GRAPHIC PREVIEW"}
        </Text>
      </Card>

      <Text style={styles.heading}>{post.title}</Text>
      <Text style={styles.body}>{post.caption}</Text>

      <Card>
        <Text style={styles.label}>Recommended slot</Text>
        <Text style={styles.heading}>
          {post.suggestedPublishAt
            ? new Date(post.suggestedPublishAt).toLocaleString()
            : "Not selected"}
        </Text>
      </Card>

      <Button label={saving ? "Approving…" : "Approve post"} onPress={saving ? undefined : approve} />
      <Button label="Edit copy" secondary />
      <Button label="Regenerate" secondary />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  platform: { color: colors.accent, fontWeight: "800" },
  placeholder: {
    color: colors.muted,
    textAlign: "center",
    paddingVertical: 72,
    fontWeight: "700",
  },
  heading: { color: colors.text, fontSize: 18, fontWeight: "700" },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase", fontWeight: "700" },
});

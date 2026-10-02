import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Card, Screen, StatusBadge } from "@/components/ui";
import { clients, posts as demoPosts } from "@/data/demo";
import { colors, spacing } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

export default function ReviewScreen() {
  const [posts, setPosts] = useState<MarketingPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [offlineDemo, setOfflineDemo] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setPosts(await api.getReviewQueue());
      setOfflineDemo(false);
    } catch {
      setPosts(demoPosts.filter((post) => post.status === "awaiting_approval"));
      setOfflineDemo(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <Screen>
      <Text style={styles.title}>Review</Text>
      <Text style={styles.sub}>
        Content reaches the calendar only after you approve it.
      </Text>
      {offlineDemo && <Text style={styles.notice}>Preview data · API not connected</Text>}

      {loading ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <View style={styles.list}>
          {posts.map((post) => {
            const demoClient = clients.find((client) => client.id === post.clientId);
            return (
              <Link key={post.id} href={`/posts/${post.id}`} asChild>
                <Pressable>
                  <Card>
                    <StatusBadge label={post.status} />
                    <Text style={styles.cardTitle}>
                      {post.clientName || demoClient?.name || "Client"} · {post.platform}
                    </Text>
                    <Text style={styles.sub}>{post.title}</Text>
                    {!!post.suggestedPublishAt && (
                      <Text style={styles.time}>
                        Suggested · {new Date(post.suggestedPublishAt).toLocaleString()}
                      </Text>
                    )}
                    {!!post.sparqScore && (
                      <Text style={styles.score}>SparQ Score {post.sparqScore}</Text>
                    )}
                  </Card>
                </Pressable>
              </Link>
            );
          })}
          {!posts.length && <Text style={styles.sub}>Nothing is waiting for approval.</Text>}
          <Text onPress={load} style={styles.refresh}>Refresh</Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 30, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  notice: { color: colors.warning, fontSize: 13 },
  list: { gap: spacing.md },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  time: { color: colors.text, fontSize: 13 },
  score: { color: colors.accent, fontWeight: "700" },
  refresh: { color: colors.accent, fontWeight: "700", paddingVertical: 12 },
});

import { Link } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api } from "@/api/client";
import {
  Card,
  PageHeader,
  PageScroll,
  StatusBadge,
} from "@/components/ui";
import { clients, posts as demoPosts } from "@/data/demo";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, spacing } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

export default function ReviewScreen() {
  const [posts, setPosts] = useState<MarketingPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [offlineDemo, setOfflineDemo] = useState(false);
  const { compact } = useResponsive();

  async function load() {
    setLoading(true);
    try {
      setPosts(await api.getReviewQueue());
      setOfflineDemo(false);
    } catch {
      setPosts(
        demoPosts.filter((post) => post.status === "awaiting_approval")
      );
      setOfflineDemo(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Approval inbox"
        title="Review"
        subtitle="Generated content stays out of the marketing calendar until you approve it."
        action={
          <Pressable onPress={load}>
            <Text style={styles.refresh}>Refresh</Text>
          </Pressable>
        }
      />

      {offlineDemo && (
        <Text style={styles.notice}>Preview data · API not connected</Text>
      )}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : posts.length ? (
        <View style={styles.grid}>
          {posts.map((post) => {
            const demoClient = clients.find(
              (client) => client.id === post.clientId
            );
            return (
              <View
                key={post.id}
                style={[
                  styles.gridItem,
                  compact && styles.gridItemCompact,
                ]}
              >
                <Link href={`/posts/${post.id}`} asChild>
                  <Pressable style={styles.pressableCard}>
                    <Card style={styles.card}>
                      <View style={styles.cardTop}>
                        <StatusBadge label={post.status} />
                        {!!post.sparqScore && (
                          <Text style={styles.score}>
                            {post.sparqScore}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.client}>
                        {post.clientName ||
                          demoClient?.name ||
                          "Client"}
                      </Text>
                      <Text style={styles.platform}>
                        {post.platform.toUpperCase()}
                      </Text>
                      <Text style={styles.cardTitle}>{post.title}</Text>
                      {!!post.suggestedPublishAt && (
                        <Text style={styles.time}>
                          Suggested ·{" "}
                          {new Date(
                            post.suggestedPublishAt
                          ).toLocaleString()}
                        </Text>
                      )}
                    </Card>
                  </Pressable>
                </Link>
              </View>
            );
          })}
        </View>
      ) : (
        <Card subtle>
          <Text style={styles.emptyTitle}>You’re caught up.</Text>
          <Text style={styles.emptyBody}>
            Nothing is waiting for approval right now.
          </Text>
        </Card>
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  refresh: {
    color: colors.primary,
    fontWeight: "800",
    paddingVertical: 8,
  },
  notice: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: "700",
  },
  loading: {
    paddingVertical: 60,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    alignItems: "stretch",
  },
  gridItem: {
    flexGrow: 1,
    flexBasis: 310,
    maxWidth: "100%",
  },
  gridItemCompact: {
    flexBasis: "100%",
  },
  pressableCard: {
    flex: 1,
  },
  card: {
    height: "100%",
    minHeight: 220,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  score: {
    color: colors.orange,
    fontSize: 22,
    fontWeight: "900",
  },
  client: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  platform: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  cardTitle: {
    color: colors.textSoft,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "700",
  },
  time: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: "auto",
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  emptyBody: {
    color: colors.muted,
  },
});

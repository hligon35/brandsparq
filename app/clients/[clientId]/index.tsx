import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { useCapabilities } from "@/auth/capabilities";
import { ClientPicker } from "@/components/client-picker";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import type { Client, MarketingPost } from "@/types/domain";
import { colors } from "@/theme/tokens";

export default function ClientWorkspace() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const router = useRouter();
  const can = useCapabilities();
  const [clients, setClients] = useState<Client[]>([]);
  const [posts, setPosts] = useState<MarketingPost[]>([]);
  const [review, setReview] = useState<MarketingPost[]>([]);
  const [accounts, setAccounts] = useState<
    Array<{ id: string; platform: string; health?: string; status?: string }>
  >([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError("");
      const from = new Date(),
        to = new Date(from.getTime() + 30 * 86400000);
      void Promise.all([
        api.getClients(),
        api.getCalendar(from.toISOString(), to.toISOString()),
        api.getReviewQueue(),
        api.getSocialAccounts(clientId),
      ])
        .then(([clientList, scheduled, reviews, connections]) => {
          if (!active) return;
          setClients(clientList);
          setPosts(
            scheduled
              .filter((post) => post.clientId === clientId)
              .sort((a, b) =>
                (a.scheduledPublishAt || "").localeCompare(b.scheduledPublishAt || ""),
              ),
          );
          setReview(reviews.filter((post) => post.clientId === clientId));
          setAccounts(connections.data);
        })
        .catch((err) => {
          if (active)
            setError(err instanceof Error ? err.message : "Unable to load client workspace.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [clientId, attempt]),
  );
  const client = clients.find((item) => item.id === clientId);
  return (
    <PageScroll>
      <PageHeader title="Client workspace" subtitle="Your brand, at a glance." />
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading client workspace" color={colors.primary} />
      ) : error ? (
        <Card>
          <Text style={styles.body}>{error}</Text>
          <Button label="Try again" onPress={() => setAttempt((value) => value + 1)} />
        </Card>
      ) : !client ? (
        <Card>
          <Text style={styles.title}>Client unavailable</Text>
          <Text style={styles.body}>This client may be archived or outside your access.</Text>
          <Link href="/clients" style={styles.link}>
            Back to clients →
          </Link>
        </Card>
      ) : (
        <>
          <ClientPicker
            clients={clients}
            value={clientId}
            onChange={(id) =>
              router.replace({
                pathname: "/clients/[clientId]",
                params: { clientId: id },
              })
            }
          />
          <View style={styles.metrics}>
            <Card style={styles.metric}>
              <Text style={styles.number}>{review.length}</Text>
              <Text style={styles.body}>Needs review</Text>
            </Card>
            <Card style={styles.metric}>
              <Text style={styles.number}>{posts.length}</Text>
              <Text style={styles.body}>Upcoming · 30 days</Text>
            </Card>
          </View>
          {can("generate", clientId) && (
            <Button
              label="Create content"
              onPress={() => router.push({ pathname: "/create", params: { clientId } })}
            />
          )}
          <Card>
            <View style={styles.section}>
              <Text style={styles.title}>Connected channels</Text>
              <Link href={{ pathname: "/social", params: { clientId } }} style={styles.link}>
                Manage →
              </Link>
            </View>
            {accounts.length ? (
              accounts.map((account) => (
                <View key={account.id} style={styles.channel}>
                  <Text style={styles.body}>{account.platform}</Text>
                  <StatusBadge label={account.health || account.status || "Not verified"} />
                </View>
              ))
            ) : (
              <Text style={styles.body}>
                No channels connected yet. Connect a channel before publishing.
              </Text>
            )}
          </Card>
          <Link href={{ pathname: "/calendar", params: { clientId } }} style={styles.link}>
            View client calendar →
          </Link>
          <Link href={{ pathname: "/analytics", params: { clientId } }} style={styles.link}>
            View client analytics →
          </Link>
          <Text accessibilityRole="header" style={styles.title}>
            Next up
          </Text>
          {posts.length ? (
            posts.slice(0, 3).map((post) => (
              <Card key={post.id}>
                <StatusBadge label={post.status} />
                <Text style={styles.title}>{post.title}</Text>
                <Text style={styles.body}>
                  {post.platform} ·{" "}
                  {post.scheduledPublishAt
                    ? new Date(post.scheduledPublishAt).toLocaleString()
                    : "Schedule pending"}
                </Text>
                <Link href={`/posts/${post.id}`} style={styles.link}>
                  View post →
                </Link>
              </Card>
            ))
          ) : (
            <Card>
              <Text style={styles.body}>
                No scheduled posts for this client in the next 30 days.
              </Text>
            </Card>
          )}
          <Text accessibilityRole="header" style={styles.title}>
            Needs review
          </Text>
          {review.length ? (
            review.slice(0, 3).map((post) => (
              <Card key={post.id}>
                <Text style={styles.title}>{post.title}</Text>
                <Link href={`/posts/${post.id}`} style={styles.link}>
                  Review post →
                </Link>
              </Card>
            ))
          ) : (
            <Text style={styles.body}>You're all caught up.</Text>
          )}
          <Link href={`/clients/${clientId}/brand`} style={styles.link}>
            Edit Brand Brain →
          </Link>
        </>
      )}
    </PageScroll>
  );
}
const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  body: { fontSize: 15, color: colors.muted, lineHeight: 23 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metric: { flexGrow: 1, flexBasis: 120, minWidth: 0, padding: 16 },
  number: { fontSize: 30, fontWeight: "900", color: colors.text },
  section: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  channel: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  link: { color: colors.primary, fontWeight: "800", minHeight: 48, paddingVertical: 14 },
});

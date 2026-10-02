import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Card, Screen, StatusBadge } from "@/components/ui";
import { clients, posts as demoPosts } from "@/data/demo";
import { colors, radius, spacing } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function sameLocalDay(value: string | undefined, date: Date) {
  if (!value) return false;
  const parsed = new Date(value);
  return (
    parsed.getFullYear() === date.getFullYear() &&
    parsed.getMonth() === date.getMonth() &&
    parsed.getDate() === date.getDate()
  );
}

export default function CalendarScreen() {
  const [selected, setSelected] = useState(startOfDay(new Date()));
  const [posts, setPosts] = useState<MarketingPost[]>([]);
  const [offlineDemo, setOfflineDemo] = useState(false);

  const days = useMemo(
    () =>
      Array.from({ length: 14 }, (_, index) => {
        const date = startOfDay(new Date());
        date.setDate(date.getDate() + index);
        return date;
      }),
    []
  );

  async function load() {
    const from = days[0].toISOString();
    const end = new Date(days[days.length - 1]);
    end.setDate(end.getDate() + 1);
    try {
      setPosts(await api.getCalendar(from, end.toISOString()));
      setOfflineDemo(false);
    } catch {
      setPosts(demoPosts.filter((post) => post.scheduledPublishAt));
      setOfflineDemo(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selectedPosts = posts.filter((post) =>
    sameLocalDay(post.scheduledPublishAt, selected)
  );

  return (
    <Screen>
      <Text style={styles.title}>Calendar</Text>
      <Text style={styles.sub}>Approved content only. Tap a post for publish controls.</Text>
      {offlineDemo && <Text style={styles.notice}>Preview data · API not connected</Text>}

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.days}>
          {days.map((day) => {
            const active = sameLocalDay(day.toISOString(), selected);
            return (
              <Pressable
                key={day.toISOString()}
                onPress={() => setSelected(day)}
                style={[styles.day, active && styles.dayActive]}
              >
                <Text style={[styles.dayName, active && styles.dayTextActive]}>
                  {day.toLocaleDateString(undefined, { weekday: "short" })}
                </Text>
                <Text style={[styles.dayNumber, active && styles.dayTextActive]}>
                  {day.getDate()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <Text style={styles.dateTitle}>
        {selected.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </Text>

      <View style={styles.list}>
        {selectedPosts.map((post) => {
          const demoClient = clients.find((client) => client.id === post.clientId);
          return (
            <Link key={post.id} href={`/posts/${post.id}/publish`} asChild>
              <Pressable>
                <Card>
                  <View style={styles.row}>
                    <StatusBadge label={post.status} />
                    <Text style={styles.platform}>{post.platform.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.cardTitle}>
                    {post.clientName || demoClient?.name || "Client"}
                  </Text>
                  <Text style={styles.sub}>{post.title}</Text>
                  <Text style={styles.time}>
                    {post.scheduledPublishAt
                      ? new Date(post.scheduledPublishAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : ""}
                  </Text>
                </Card>
              </Pressable>
            </Link>
          );
        })}
        {!selectedPosts.length && (
          <Card>
            <Text style={styles.sub}>No approved posts scheduled for this day.</Text>
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 30, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  notice: { color: colors.warning, fontSize: 13 },
  days: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  day: {
    width: 58,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  dayActive: { backgroundColor: colors.accent },
  dayName: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  dayNumber: { color: colors.text, fontSize: 20, fontWeight: "800" },
  dayTextActive: { color: "#FFFFFF" },
  dateTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  list: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  platform: { color: colors.accent, fontWeight: "800", fontSize: 12 },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  time: { color: colors.text, fontWeight: "700" },
});

import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
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
  const { compact } = useResponsive();

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
    <PageScroll>
      <PageHeader
        eyebrow="Approved strategy"
        title="Calendar"
        subtitle="Only approved content appears here. Select a scheduled post for final publish controls."
      />

      {offlineDemo && (
        <Text style={styles.notice}>Preview data · API not connected</Text>
      )}

      <Card subtle style={styles.dateRailCard}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          <View style={styles.days}>
            {days.map((day) => {
              const active = sameLocalDay(day.toISOString(), selected);
              return (
                <Pressable
                  key={day.toISOString()}
                  onPress={() => setSelected(day)}
                  style={[styles.day, active && styles.dayActive]}
                >
                  <Text
                    style={[
                      styles.dayName,
                      active && styles.dayTextActive,
                    ]}
                  >
                    {day.toLocaleDateString(undefined, {
                      weekday: "short",
                    })}
                  </Text>
                  <Text
                    style={[
                      styles.dayNumber,
                      active && styles.dayTextActive,
                    ]}
                  >
                    {day.getDate()}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </Card>

      <Text style={styles.dateTitle}>
        {selected.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </Text>

      {selectedPosts.length ? (
        <View style={styles.grid}>
          {selectedPosts.map((post) => {
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
                <Link
                  href={`/posts/${post.id}/publish`}
                  asChild
                >
                  <Pressable>
                    <Card style={styles.postCard}>
                      <View style={styles.row}>
                        <StatusBadge label={post.status} />
                        <Text style={styles.platform}>
                          {post.platform.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.cardTitle}>
                        {post.clientName ||
                          demoClient?.name ||
                          "Client"}
                      </Text>
                      <Text style={styles.sub}>{post.title}</Text>
                      <View style={styles.timePill}>
                        <Text style={styles.time}>
                          {post.scheduledPublishAt
                            ? new Date(
                                post.scheduledPublishAt
                              ).toLocaleTimeString([], {
                                hour: "numeric",
                                minute: "2-digit",
                              })
                            : ""}
                        </Text>
                      </View>
                    </Card>
                  </Pressable>
                </Link>
              </View>
            );
          })}
        </View>
      ) : (
        <Card subtle>
          <Text style={styles.emptyTitle}>Open space</Text>
          <Text style={styles.sub}>
            No approved posts are scheduled for this day.
          </Text>
        </Card>
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  sub: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  notice: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: "700",
  },
  dateRailCard: {
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  days: {
    flexDirection: "row",
    gap: 8,
  },
  day: {
    width: 62,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayName: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  dayNumber: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  dayTextActive: {
    color: colors.white,
  },
  dateTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  gridItem: {
    flexGrow: 1,
    flexBasis: 310,
    maxWidth: "100%",
  },
  gridItemCompact: {
    flexBasis: "100%",
  },
  postCard: {
    minHeight: 200,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  platform: {
    color: colors.primary,
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 1,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  timePill: {
    marginTop: "auto",
    alignSelf: "flex-start",
    backgroundColor: "#EAF3FF",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  time: {
    color: colors.primaryDark,
    fontWeight: "900",
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
});

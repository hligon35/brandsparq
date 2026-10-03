import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";
import type { Client, MarketingPost, Platform } from "@/types/domain";

type CalendarMode = "day" | "week" | "month";

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

function rangeDays(mode: CalendarMode) {
  return mode === "day" ? 1 : mode === "week" ? 7 : 30;
}

export default function CalendarScreen() {
  const [mode, setMode] = useState<CalendarMode>("week");
  const [selected, setSelected] = useState(startOfDay(new Date()));
  const [posts, setPosts] = useState<MarketingPost[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientFilter, setClientFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState<"all" | Platform>("all");

  const days = useMemo(() => {
    const count = rangeDays(mode);
    return Array.from({ length: count }, (_, index) => {
      const date = startOfDay(new Date());
      date.setDate(date.getDate() + index);
      return date;
    });
  }, [mode]);

  async function load() {
    const from = days[0].toISOString();
    const end = new Date(days[days.length - 1]);
    end.setDate(end.getDate() + 1);
    const [calendar, clientRows] = await Promise.all([
      api.getCalendar(from, end.toISOString()),
      api.getClients(),
    ]);
    setPosts(calendar);
    setClients(clientRows);
  }

  useEffect(() => {
    void load().catch(() => {
      setPosts([]);
      setClients([]);
    });
  }, [mode]);

  const filteredPosts = posts.filter((post) => {
    if (clientFilter !== "all" && post.clientId !== clientFilter) return false;
    if (platformFilter !== "all" && post.platform !== platformFilter) return false;
    return true;
  });

  const selectedPosts = filteredPosts.filter((post) =>
    sameLocalDay(post.scheduledPublishAt, selected)
  );

  const platformOptions: Array<"all" | Platform> = [
    "all",
    "instagram",
    "facebook",
    "linkedin",
    "tiktok",
    "x",
  ];

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Approved strategy"
        title="Calendar"
        subtitle="Switch between day, week, and month planning; filter by client or platform; open a post for final publish controls."
      />

      <View style={styles.modeRow}>
        {(["day", "week", "month"] as CalendarMode[]).map((item) => (
          <Pressable
            key={item}
            onPress={() => {
              setMode(item);
              setSelected(startOfDay(new Date()));
            }}
            style={[styles.modeButton, mode === item && styles.modeButtonActive]}
          >
            <Text style={[styles.modeText, mode === item && styles.modeTextActive]}>
              {item}
            </Text>
          </Pressable>
        ))}
      </View>

      <Card subtle>
        <Text style={styles.filterLabel}>Client</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chips}>
            <Pressable
              onPress={() => setClientFilter("all")}
              style={[styles.chip, clientFilter === "all" && styles.chipActive]}
            >
              <Text style={[styles.chipText, clientFilter === "all" && styles.chipTextActive]}>
                All clients
              </Text>
            </Pressable>
            {clients.map((client) => (
              <Pressable
                key={client.id}
                onPress={() => setClientFilter(client.id)}
                style={[styles.chip, clientFilter === client.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, clientFilter === client.id && styles.chipTextActive]}>
                  {client.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <Text style={styles.filterLabel}>Platform</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chips}>
            {platformOptions.map((platform) => (
              <Pressable
                key={platform}
                onPress={() => setPlatformFilter(platform)}
                style={[styles.chip, platformFilter === platform && styles.chipActive]}
              >
                <Text style={[styles.chipText, platformFilter === platform && styles.chipTextActive]}>
                  {platform === "all" ? "All platforms" : platform}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </Card>

      <Card subtle style={styles.dateRailCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.days}>
            {days.map((day) => {
              const active = sameLocalDay(day.toISOString(), selected);
              const dayPosts = filteredPosts.filter((post) =>
                sameLocalDay(post.scheduledPublishAt, day)
              ).length;
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
                  <Text style={[styles.dayCount, active && styles.dayTextActive]}>
                    {dayPosts}
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
          {selectedPosts.map((post) => (
            <Link key={post.id} href={`/posts/${post.id}/publish`} asChild>
              <Pressable style={styles.gridItem}>
                <Card style={styles.postCard}>
                  <View style={styles.row}>
                    <StatusBadge label={post.status} />
                    <Text style={styles.platform}>{post.platform.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{post.clientName || "Client"}</Text>
                  <Text style={styles.sub}>{post.title}</Text>
                  <Text style={styles.destination}>
                    {post.socialAccountName || "Publishing account not assigned"}
                  </Text>
                  <View style={styles.timePill}>
                    <Text style={styles.time}>
                      {post.scheduledPublishAt
                        ? new Date(post.scheduledPublishAt).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : ""}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            </Link>
          ))}
        </View>
      ) : (
        <Card subtle>
          <Text style={styles.emptyTitle}>Open space</Text>
          <Text style={styles.sub}>No approved posts match these filters for this day.</Text>
        </Card>
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  modeRow:{flexDirection:"row",gap:8},
  modeButton:{paddingHorizontal:16,paddingVertical:10,borderRadius:radius.pill,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
  modeButtonActive:{backgroundColor:colors.primary,borderColor:colors.primary},
  modeText:{color:colors.textSoft,fontWeight:"800",textTransform:"capitalize"},
  modeTextActive:{color:colors.white},
  filterLabel:{color:colors.muted,fontSize:11,fontWeight:"900",textTransform:"uppercase",letterSpacing:.8},
  chips:{flexDirection:"row",gap:8,paddingVertical:5},
  chip:{paddingHorizontal:13,paddingVertical:8,borderRadius:radius.pill,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
  chipActive:{backgroundColor:colors.primary,borderColor:colors.primary},
  chipText:{color:colors.textSoft,fontWeight:"700",textTransform:"capitalize"},
  chipTextActive:{color:colors.white},
  dateRailCard:{paddingVertical:12,paddingHorizontal:12},
  days:{flexDirection:"row",gap:8},
  day:{width:64,paddingVertical:9,alignItems:"center",borderRadius:radius.md,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
  dayActive:{backgroundColor:colors.primary,borderColor:colors.primary},
  dayName:{color:colors.muted,fontSize:10,fontWeight:"800",textTransform:"uppercase"},
  dayNumber:{color:colors.text,fontSize:19,fontWeight:"900"},
  dayCount:{color:colors.primary,fontSize:10,fontWeight:"900"},
  dayTextActive:{color:colors.white},
  dateTitle:{color:colors.text,fontSize:20,fontWeight:"900"},
  grid:{flexDirection:"row",flexWrap:"wrap",gap:spacing.md},
  gridItem:{flexGrow:1,flexBasis:300,maxWidth:"100%"},
  postCard:{minHeight:205},
  row:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:spacing.sm},
  platform:{color:colors.primary,fontWeight:"900",fontSize:11,letterSpacing:1},
  cardTitle:{color:colors.text,fontSize:19,fontWeight:"900"},
  sub:{color:colors.muted,fontSize:15,lineHeight:22},
  destination:{color:colors.textSoft,fontSize:12,fontWeight:"700"},
  timePill:{marginTop:"auto",alignSelf:"flex-start",backgroundColor:"#EAF3FF",borderRadius:radius.pill,paddingHorizontal:12,paddingVertical:7},
  time:{color:colors.primaryDark,fontWeight:"900"},
  emptyTitle:{color:colors.text,fontSize:20,fontWeight:"900"}
});

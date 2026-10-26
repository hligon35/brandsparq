import { zonedTime, zonedParts, schedulePreset } from "@/shared/zoned-time";
import { TimePicker } from "@/components/pickers";
import { Alert } from "@/components/feedback";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, SectionTitle } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";

function localDateValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function localTimeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const options = [
  { kind: "two_hours" as const, title: "Two hours from now", icon: "time-outline" as const },
  {
    kind: "tomorrow_morning" as const,
    title: "Tomorrow · 9:00 AM",
    icon: "sunny-outline" as const,
  },
  { kind: "tomorrow_evening" as const, title: "Tomorrow · 6:00 PM", icon: "moon-outline" as const },
];

export default function RescheduleScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [post, setPost] = useState<any>(null);
  const [timezone, setTimezone] = useState("");
  const [dateText, setDateText] = useState(localDateValue(new Date()));
  const [timeText, setTimeText] = useState(
    localTimeValue(new Date(Date.now() + 2 * 60 * 60 * 1000)),
  );
  const [working, setWorking] = useState(false);
  const [suggested, setSuggested] = useState<string>("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([api.getPost(postId), api.getClients()])
      .then(([p, clients]) => {
        if (!active) return;
        setPost(p);
        const client = clients.find((c) => c.id === p.clientId);
        setTimezone(client?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
        const base = p.scheduledPublishAt
          ? new Date(p.scheduledPublishAt)
          : new Date(Date.now() + 2 * 60 * 60 * 1000);
        const parts = zonedParts(
          base,
          client?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        );
        setDateText(parts.date);
        setTimeText(parts.time);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load post.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [postId, attempt]);

  async function apply(date: Date) {
    if (!postId || !post || loading || error || working) return;
    setWorking(true);
    try {
      const result = await api.reschedulePost(postId, date.toISOString());
      const scheduled = new Date(result.scheduledPublishAt);
      Alert.alert(
        result.adjusted ? "Rescheduled to next available slot" : "Rescheduled",
        `New time: ${scheduled.toLocaleString(undefined, { timeZone: timezone })} (${timezone})`,
      );
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: "/calendar", params: { clientId: post.clientId } });
    } catch (error) {
      Alert.alert("Unable to reschedule", error instanceof Error ? error.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  async function choose(kind: "two_hours" | "tomorrow_morning" | "tomorrow_evening") {
    await apply(schedulePreset(kind, timezone));
  }

  async function submitCustom() {
    const parsed = zonedTime(
      dateText,
      timeText,
      timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    if (Number.isNaN(parsed.getTime())) {
      Alert.alert(
        "Invalid date or time",
        "Choose a valid date and time. Some times do not exist when daylight saving time changes.",
      );
      return;
    }
    await apply(parsed);
  }

  async function recommend() {
    if (!post?.clientId) return;
    const parsed = zonedTime(
      dateText,
      timeText,
      timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    setWorking(true);
    try {
      const result = await api.recommendSchedule(
        post.clientId,
        Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString(),
      );
      setSuggested(result.data.scheduledAt);
      const date = new Date(result.data.scheduledAt);
      const parts = zonedParts(date, timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
      setDateText(parts.date);
      setTimeText(parts.time);
    } catch (error) {
      Alert.alert(
        "Unable to recommend a slot",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Calendar control"
        title="Reschedule"
        subtitle="Choose a quick option or enter an exact date and time. BrandSparQ validates every change against spacing, blackout, daily-limit, and preferred-window rules."
      />

      {loading && <Text accessibilityLiveRegion="polite">Loading schedule…</Text>}
      {!!error && (
        <Card>
          <Text accessibilityRole="alert">{error}</Text>
          <Button label="Try again" onPress={() => setAttempt((value) => value + 1)} />
        </Card>
      )}
      <View style={styles.grid}>
        {options.map((option) => (
          <Pressable
            key={option.kind}
            accessibilityRole="button"
            accessibilityState={{ disabled: loading || !!error || working }}
            disabled={loading || !!error || working}
            onPress={() => choose(option.kind)}
            style={styles.gridItem}
          >
            <Card style={styles.optionCard}>
              <Ionicons name={option.icon} color={colors.primary} size={27} />
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.optionHint}>Choose this time →</Text>
            </Card>
          </Pressable>
        ))}
      </View>

      <Card>
        <SectionTitle
          title="Custom date & time"
          subtitle={`Scheduling in ${timezone || "the client timezone"}.`}
        />
        <View style={styles.formRow}>
          <View style={styles.field}>
            <Text style={styles.label}>Date</Text>
            <TextInput
              value={dateText}
              onChangeText={setDateText}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <TimePicker value={timeText} onChange={setTimeText} />
          </View>
        </View>
        {!!suggested && (
          <Text style={styles.suggested}>
            BrandSparQ recommendation:{" "}
            {new Date(suggested).toLocaleString(undefined, { timeZone: timezone })}
          </Text>
        )}
        <View style={styles.actions}>
          <Button
            label="Find next available"
            secondary
            onPress={working || loading || !!error ? undefined : recommend}
          />
          <Button
            label={working ? "Saving…" : "Save custom time"}
            onPress={working || loading || !!error ? undefined : submitCustom}
          />
        </View>
      </Card>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  gridItem: { flexGrow: 1, flexBasis: 250, maxWidth: "100%" },
  optionCard: { minHeight: 170, justifyContent: "center" },
  optionTitle: { color: colors.text, fontSize: 19, fontWeight: "900" },
  optionHint: { color: colors.primary, fontWeight: "800" },
  formRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  field: { flexGrow: 1, flexBasis: 220, gap: 6 },
  label: { color: colors.textSoft, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  input: {
    minHeight: 48,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  suggested: { color: colors.primary, fontWeight: "800" },
});

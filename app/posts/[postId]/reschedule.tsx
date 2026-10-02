import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Card, PageHeader, PageScroll } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

function optionDate(
  kind: "two_hours" | "tomorrow_morning" | "tomorrow_evening"
) {
  const date = new Date();

  if (kind === "two_hours") date.setHours(date.getHours() + 2);
  if (kind === "tomorrow_morning") {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  }
  if (kind === "tomorrow_evening") {
    date.setDate(date.getDate() + 1);
    date.setHours(18, 0, 0, 0);
  }

  return date;
}

const options = [
  {
    kind: "two_hours" as const,
    title: "Two hours from now",
    icon: "time-outline" as const,
  },
  {
    kind: "tomorrow_morning" as const,
    title: "Tomorrow · 9:00 AM",
    icon: "sunny-outline" as const,
  },
  {
    kind: "tomorrow_evening" as const,
    title: "Tomorrow · 6:00 PM",
    icon: "moon-outline" as const,
  },
];

export default function RescheduleScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();

  async function choose(
    kind: "two_hours" | "tomorrow_morning" | "tomorrow_evening"
  ) {
    if (!postId) return;

    const date = optionDate(kind);
    try {
      await api.reschedulePost(postId, date.toISOString());
      Alert.alert("Rescheduled", `New time: ${date.toLocaleString()}`);
      router.dismissAll();
    } catch (error) {
      Alert.alert(
        "Unable to reschedule",
        error instanceof Error ? error.message : "Try again."
      );
    }
  }

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Calendar control"
        title="Reschedule"
        subtitle="Choose a quick option now. A full date/time picker can be layered into the calendar editor next."
      />

      <View style={styles.grid}>
        {options.map((option) => (
          <Pressable
            key={option.kind}
            onPress={() => choose(option.kind)}
            style={styles.gridItem}
          >
            <Card style={styles.optionCard}>
              <Ionicons
                name={option.icon}
                color={colors.primary}
                size={27}
              />
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.optionHint}>Choose this time →</Text>
            </Card>
          </Pressable>
        ))}
      </View>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  gridItem: {
    flexGrow: 1,
    flexBasis: 250,
    maxWidth: "100%",
  },
  optionCard: {
    minHeight: 170,
    justifyContent: "center",
  },
  optionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  optionHint: {
    color: colors.primary,
    fontWeight: "800",
  },
});

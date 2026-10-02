import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, StyleSheet, Text } from "react-native";
import { api } from "@/api/client";
import { Button, Card, Screen } from "@/components/ui";
import { colors } from "@/theme/tokens";

function optionDate(kind: "two_hours" | "tomorrow_morning" | "tomorrow_evening") {
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

export default function RescheduleScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();

  async function choose(kind: "two_hours" | "tomorrow_morning" | "tomorrow_evening") {
    if (!postId) return;
    const date = optionDate(kind);
    try {
      await api.reschedulePost(postId, date.toISOString());
      Alert.alert("Rescheduled", `New time: ${date.toLocaleString()}`);
      router.dismissAll();
    } catch (error) {
      Alert.alert("Unable to reschedule", error instanceof Error ? error.message : "Try again.");
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>Reschedule</Text>
      <Text style={styles.sub}>Choose a quick option. A full date/time picker comes in the calendar editing phase.</Text>
      <Card>
        <Button label="Two hours from now" onPress={() => choose("two_hours")} />
        <Button label="Tomorrow · 9:00 AM" secondary onPress={() => choose("tomorrow_morning")} />
        <Button label="Tomorrow · 6:00 PM" secondary onPress={() => choose("tomorrow_evening")} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 22 },
});

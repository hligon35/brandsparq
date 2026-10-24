import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Client } from "@/types/domain";
import { colors, radius } from "@/theme/tokens";

export function ClientPicker({
  clients,
  value,
  onChange,
}: {
  clients: Client[];
  value: string;
  onChange(id: string): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const selected = clients.find((client) => client.id === value);
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select client: ${selected?.name || "Choose client"}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={styles.row}
      >
        <View style={[styles.avatar, { backgroundColor: selected?.color || colors.primary }]}>
          <Text style={styles.initial}>{selected?.name.slice(0, 1) || "?"}</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.caption}>Working on</Text>
          <Text style={styles.name}>{selected?.name || "Choose client"}</Text>
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={colors.text} />
      </Pressable>
      {expanded &&
        clients.map((client) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: client.id === value }}
            key={client.id}
            style={styles.option}
            onPress={() => {
              onChange(client.id);
              setExpanded(false);
            }}
          >
            <Text style={styles.name}>{client.name}</Text>
            {client.id === value && <Ionicons name="checkmark" size={20} color={colors.primary} />}
          </Pressable>
        ))}
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: { padding: 16, minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { color: colors.white, fontSize: 20, fontWeight: "800" },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  caption: { color: colors.muted, fontSize: 12 },
  name: { color: colors.text, fontWeight: "800", fontSize: 16, flexShrink: 1 },
  option: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: 16,
    minHeight: 52,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

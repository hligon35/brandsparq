import { useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Client } from "@/types/domain";
import { colors, radius } from "@/theme/tokens";

export function ClientPicker({
  clients,
  value,
  onChange,
  disabled = false,
}: {
  clients: Client[];
  value: string;
  onChange(id: string): void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const selected = clients.find((client) => client.id === value);
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select client: ${selected?.name || "Choose client"}`}
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={() => {
          setQuery("");
          setExpanded(true);
        }}
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
      <Modal
        visible={expanded}
        transparent
        animationType="fade"
        onRequestClose={() => setExpanded(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.overlay}
        >
          <Pressable
            accessibilityLabel="Close client selector"
            style={StyleSheet.absoluteFill}
            onPress={() => setExpanded(false)}
          />
          <View accessibilityViewIsModal style={styles.dialog}>
            <Text accessibilityRole="header" style={styles.name}>
              Choose client
            </Text>
            <TextInput
              accessibilityLabel="Search clients"
              placeholder="Search clients…"
              value={query}
              onChangeText={setQuery}
              style={styles.search}
              autoCorrect={false}
            />
            <FlatList
              style={{ maxHeight: 360, flexShrink: 1 }}
              keyboardShouldPersistTaps="handled"
              data={clients.filter((client) =>
                client.name.toLowerCase().includes(query.trim().toLowerCase()),
              )}
              keyExtractor={(client) => client.id}
              ListEmptyComponent={<Text style={styles.empty}>No matching clients.</Text>}
              renderItem={({ item: client }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Choose ${client.name}`}
                  accessibilityState={{ selected: client.id === value }}
                  aria-pressed={client.id === value}
                  style={styles.option}
                  onPress={() => {
                    setExpanded(false);
                    onChange(client.id);
                  }}
                >
                  <Text style={styles.name}>{client.name}</Text>
                  {client.id === value && (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  )}
                </Pressable>
              )}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpanded(false)}
              style={styles.option}
            >
              <Text style={styles.name}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(7,27,51,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  dialog: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "85%",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 16,
    gap: 12,
  },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    color: colors.text,
  },
  empty: { padding: 16, color: colors.muted },
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

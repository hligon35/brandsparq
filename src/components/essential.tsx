import { Ionicons } from "@expo/vector-icons";
import { useState, type PropsWithChildren, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "./ui";
import { colors, spacing } from "@/theme/tokens";

/** Keep form children mounted so closing a section never discards an unsaved edit. */
export function EssentialSection({
  title,
  summary,
  children,
  defaultOpen = true,
  collapsible = true,
}: PropsWithChildren<{
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
}>) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          style={essentialStyles.sectionHeader}
        >
          <View style={essentialStyles.copy}>
            <Text style={essentialStyles.title}>{title}</Text>
            {!!summary && <Text style={essentialStyles.meta}>{summary}</Text>}
          </View>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
        </Pressable>
      ) : (
        <View style={essentialStyles.sectionHeader}>
          <View style={essentialStyles.copy}>
            <Text accessibilityRole="header" style={essentialStyles.title}>
              {title}
            </Text>
            {!!summary && <Text style={essentialStyles.meta}>{summary}</Text>}
          </View>
        </View>
      )}
      <View style={[essentialStyles.content, { display: !collapsible || open ? "flex" : "none" }]}>
        {children}
      </View>
    </Card>
  );
}

export function EssentialRow({
  title,
  detail,
  trailing,
  children,
}: PropsWithChildren<{ title: string; detail?: string; trailing?: ReactNode }>) {
  return (
    <View style={essentialStyles.row}>
      <View style={essentialStyles.rowTop}>
        <View style={essentialStyles.copy}>
          <Text style={essentialStyles.title}>{title}</Text>
          {!!detail && <Text style={essentialStyles.meta}>{detail}</Text>}
        </View>
        {trailing}
      </View>
      {children}
    </View>
  );
}

export const essentialStyles = StyleSheet.create({
  content: { gap: 12, minWidth: 0 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: colors.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  row: { gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 15,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});

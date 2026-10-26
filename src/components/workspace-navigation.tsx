import { Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCapabilities } from "@/auth/capabilities";
import { colors } from "@/theme/tokens";

const destinations = [
  { label: "Home", href: "/", icon: "home-outline" },
  { label: "Clients", href: "/clients", icon: "people-outline" },
  { label: "Create", href: "/create", icon: "add-circle-outline" },
  { label: "Calendar", href: "/calendar", icon: "calendar-outline" },
  { label: "More", href: "/more", icon: "grid-outline" },
] as const;

/** Primary destinations remain reachable from secondary screens and direct links. */
export function WorkspaceNavigation() {
  const can = useCapabilities();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityLabel="Workspace navigation"
      style={[styles.bar, { paddingBottom: Math.max(8, insets.bottom) }]}
    >
      {destinations
        .filter((item) => item.href !== "/create" || can("generate"))
        .map((item) => {
          const active =
            item.href === "/clients"
              ? pathname.startsWith("/clients/")
              : item.href === "/more" &&
                [
                  "/generation",
                  "/paused",
                  "/campaigns",
                  "/social",
                  "/analytics",
                  "/access",
                  "/system",
                ].some((route) => pathname === route || pathname.startsWith(`${route}/`));
          return (
            <Link key={item.href} href={item.href} asChild>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: active }}
                style={styles.item}
              >
                <Ionicons
                  name={item.icon}
                  size={23}
                  color={active ? colors.primary : colors.muted}
                />
                <Text style={[styles.label, { color: active ? colors.primary : colors.muted }]}>
                  {item.label}
                </Text>
              </Pressable>
            </Link>
          );
        })}
    </View>
  );
}
const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 7,
  },
  item: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 3 },
  label: { fontSize: 11, fontWeight: "700" },
});

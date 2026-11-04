import { Ionicons } from "@expo/vector-icons";
import { Link, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/context";
import { Card, PageHeader, PageScroll } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";

const items: {
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
}[] = [
  {
    label: "Review queue",
    description: "Approve pending content.",
    icon: "list-outline",
    href: "/review" as Href,
  },
  {
    label: "Generation progress",
    description: "Track content creation and recovery.",
    icon: "sparkles-outline",
    href: "/generation" as Href,
  },
  {
    label: "Paused content",
    description: "Restore paused review and calendar work.",
    icon: "pause-circle-outline",
    href: "/paused" as Href,
  },
  {
    label: "Campaigns",
    description: "Group generated content around goals and deadlines.",
    icon: "layers-outline",
    href: "/campaigns" as Href,
  },
  {
    label: "Social connections",
    description: "Connect and verify publishing destinations.",
    icon: "share-social-outline",
    href: "/social" as Href,
  },
  {
    label: "Analytics",
    description: "Measure published content and campaign results.",
    icon: "analytics-outline",
    href: "/analytics" as Href,
  },
];

export default function MoreScreen() {
  const { user } = useAuth();
  const visibleItems =
    user?.role === "owner"
      ? [
          ...items,
          {
            label: "Access management",
            description: "Roles and client-level permissions.",
            icon: "people-outline" as keyof typeof Ionicons.glyphMap,
            href: "/access" as Href,
          },
          {
            label: "System health",
            description: "Readiness, incidents, and recovery.",
            icon: "pulse-outline" as keyof typeof Ionicons.glyphMap,
            href: "/system" as Href,
          },
        ]
      : items.filter((item) => item.href !== "/settings");

  return (
    <PageScroll>
      <PageHeader title="More" subtitle="Your publishing and workspace tools." />

      <View style={styles.grid}>
        {visibleItems.map((item) => {
          const content = (
            <Card style={styles.itemCard}>
              <View style={styles.iconWrap}>
                <Ionicons name={item.icon} size={23} color={colors.primary} />
              </View>
              <Text style={styles.item} numberOfLines={2}>
                {item.label}
              </Text>
              <Text style={styles.description} numberOfLines={2}>
                {item.description}
              </Text>
            </Card>
          );

          return item.href ? (
            <Link key={item.label} href={item.href} asChild>
              <Pressable style={styles.gridItem}>{content}</Pressable>
            </Link>
          ) : (
            <View key={item.label} style={styles.gridItem}>
              {content}
            </View>
          );
        })}
      </View>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: "4%",
    rowGap: 12,
  },
  gridItem: {
    width: "48%",
    flexGrow: 0,
  },
  itemCard: {
    minHeight: 174,
    height: 174,
    flex: 1,
    padding: 14,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  item: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  description: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  coming: {
    marginTop: "auto",
    color: colors.orange,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  accountCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  accountCopy: {
    gap: 3,
  },
  accountTitle: {
    color: colors.text,
    fontWeight: "900",
    fontSize: 17,
  },
  signOut: {
    minWidth: 140,
  },
});

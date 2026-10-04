import { Ionicons } from "@expo/vector-icons";
import { Link, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/context";
import { Button, Card, PageHeader, PageScroll } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";

const items: {
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
}[] = [
  {
    label: "Clients & Brand Brain",
    description: "Voice, audience, colors, CTAs, and brand rules.",
    icon: "color-palette-outline",
    href: "/clients" as Href,
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
    label: "Notifications",
    description: "Control review and pre-publish alerts.",
    icon: "notifications-outline",
    href: "/notifications" as Href,
  },
  {
    label: "Analytics",
    description: "Measure published content and campaign results.",
    icon: "analytics-outline",
    href: "/analytics" as Href,
  },
  {
    label: "Settings",
    description: "Workspace, account, and publishing preferences.",
    icon: "settings-outline",
    href: "/settings" as Href,
  },
];

export default function MoreScreen() {
  const { user, signOut } = useAuth();
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
            description: "Production readiness, incidents, queues, and recovery.",
            icon: "pulse-outline" as keyof typeof Ionicons.glyphMap,
            href: "/system" as Href,
          },
        ]
      : items;

  return (
    <PageScroll>
      <PageHeader eyebrow="Workspace" title="More" subtitle={user?.email || "Manage BrandSparQ"} />

      <View style={styles.grid}>
        {visibleItems.map((item) => {
          const content = (
            <Card style={styles.itemCard}>
              <View style={styles.iconWrap}>
                <Ionicons name={item.icon} size={23} color={colors.primary} />
              </View>
              <Text style={styles.item}>{item.label}</Text>
              <Text style={styles.description}>{item.description}</Text>
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

      <Card subtle style={styles.accountCard}>
        <View style={styles.accountCopy}>
          <Text style={styles.accountTitle}>Account</Text>
          <Text style={styles.description}>{user?.email}</Text>
        </View>
        <View style={styles.signOut}>
          <Button label="Sign out" secondary onPress={signOut} />
        </View>
      </Card>
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
    flexBasis: 300,
    maxWidth: "100%",
  },
  itemCard: {
    minHeight: 205,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: "#EAF3FF",
    alignItems: "center",
    justifyContent: "center",
  },
  item: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  description: {
    color: colors.muted,
    lineHeight: 21,
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

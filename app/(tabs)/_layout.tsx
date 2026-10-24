import { useCapabilities } from "@/auth/capabilities";
import { Ionicons } from "@expo/vector-icons";
import { Link, Redirect, Tabs, usePathname } from "expo-router";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth/context";
import { HeaderActions } from "@/components/header-actions";
import { BrandLogo } from "@/components/brand";
import { breakpoints } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";

const navItems = [
  { label: "Home", href: "/" as const },
  { label: "Clients", href: "/clients" as const },
  { label: "Create", href: "/create" as const },
  { label: "Calendar", href: "/calendar" as const },
  { label: "More", href: "/more" as const },
];

function DesktopHeader() {
  const can = useCapabilities();
  const pathname = usePathname();

  return (
    <View style={styles.desktopHeader}>
      <View style={styles.desktopHeaderInner}>
        <BrandLogo compact />
        <View style={styles.desktopNav}>
          {navItems
            .filter((item) => item.href !== "/create" || can("generate"))
            .map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link key={item.label} href={item.href} asChild>
                  <Pressable
                    style={StyleSheet.flatten([
                      styles.desktopNavItem,
                      active ? styles.desktopNavItemActive : undefined,
                    ])}
                  >
                    <Text style={[styles.desktopNavText, active && styles.desktopNavTextActive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                </Link>
              );
            })}
        </View>
        <HeaderActions />
      </View>
    </View>
  );
}

function MobileHeader() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.mobileHeader, { paddingTop: insets.top + 8 }]}>
      <BrandLogo compact />
      <HeaderActions />
    </View>
  );
}

export default function TabsLayout() {
  const can = useCapabilities();
  const { ready, user } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktopWeb = Platform.OS === "web" && width >= breakpoints.wide;

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        header: () => (desktopWeb ? <DesktopHeader /> : <MobileHeader />),
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: desktopWeb
          ? { display: "none" }
          : [
              styles.tabBar,
              { height: 64 + insets.bottom, paddingBottom: Math.max(8, insets.bottom) },
            ],
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="home-outline"
              color={typeof color === "string" ? color : colors.muted}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="review"
        options={{
          title: "Review",
          href: null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="checkmark-circle-outline"
              color={typeof color === "string" ? color : colors.muted}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: "Create",
          href: can("generate") ? "/create" : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="add-circle-outline"
              color={typeof color === "string" ? color : colors.muted}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="calendar-outline"
              color={typeof color === "string" ? color : colors.muted}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: "Clients",
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="people-outline"
              color={typeof color === "string" ? color : colors.muted}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="grid-outline"
              color={typeof color === "string" ? color : colors.muted}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  mobileHeader: {
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bell: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    minHeight: 66,
    paddingTop: 7,
    paddingBottom: 7,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  desktopHeader: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  desktopHeaderInner: {
    minHeight: 76,
    width: "100%",
    maxWidth: 1244,
    alignSelf: "center",
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xl,
  },
  desktopNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  desktopNavItem: {
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  desktopNavItemActive: {
    backgroundColor: "#EAF3FF",
  },
  desktopNavText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
  },
  desktopNavTextActive: {
    color: colors.primaryDark,
  },
});

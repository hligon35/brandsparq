import type { PropsWithChildren, ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, shadows, spacing } from "@/theme/tokens";

export function Screen({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const responsive = useResponsive();

  return (
    <View style={styles.screen}>
      <View
        style={[
          styles.screenInner,
          {
            maxWidth: responsive.maxContentWidth,
            paddingHorizontal: responsive.gutter,
            paddingVertical: responsive.compact ? spacing.md : spacing.lg,
          },
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export function PageScroll({
  children,
  contentStyle,
  ...props
}: PropsWithChildren<ScrollViewProps & { contentStyle?: StyleProp<ViewStyle> }>) {
  const responsive = useResponsive();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingHorizontal: responsive.gutter,
          paddingVertical: responsive.compact ? spacing.md : spacing.lg,
        },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      {...props}
    >
      <View style={[styles.scrollInner, { maxWidth: responsive.maxContentWidth }]}>{children}</View>
    </ScrollView>
  );
}

export function Card({
  children,
  style,
  subtle = false,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  subtle?: boolean;
}>) {
  return <View style={[styles.card, subtle && styles.cardSubtle, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  secondary = false,
  danger = false,
  small = false,
}: {
  label: string;
  onPress?: () => void;
  secondary?: boolean;
  danger?: boolean;
  small?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        secondary && styles.secondary,
        danger && styles.danger,
        !onPress && styles.disabled,
        pressed && !!onPress && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

export function StatusBadge({ label }: { label: string }) {
  const normalized = label.toLowerCase();
  const palette = normalized.includes("published")
    ? { bg: "#E7F8F1", text: colors.success }
    : normalized.includes("failed") || normalized.includes("cancel")
      ? { bg: "#FDECEF", text: colors.danger }
      : normalized.includes("approval") || normalized.includes("review")
        ? { bg: "#FFF3DE", text: colors.warning }
        : normalized.includes("publish")
          ? { bg: "#E8F8FB", text: "#007C8C" }
          : { bg: "#EAF2FF", text: colors.primaryDark };

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label.replaceAll("_", " ")}`}
      style={[styles.badge, { backgroundColor: palette.bg }]}
    >
      <Text style={[styles.badgeText, { color: palette.text }]}>{label.replaceAll("_", " ")}</Text>
    </View>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const { compact } = useResponsive();

  return (
    <View style={[styles.pageHeader, !compact && styles.pageHeaderWide]}>
      <View style={styles.pageHeaderCopy}>
        {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
        <Text
          accessibilityRole="header"
          style={[styles.pageTitle, compact && styles.pageTitleCompact]}
        >
          {title}
        </Text>
        {!!subtitle && <Text style={styles.pageSubtitle}>{subtitle}</Text>}
      </View>
      {!!action && <View style={styles.pageHeaderAction}>{action}</View>}
    </View>
  );
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionTitleWrap}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  screenInner: {
    width: "100%",
    alignSelf: "center",
    flex: 1,
    gap: spacing.md,
  },
  scrollContent: {
    flexGrow: 1,
  },
  scrollInner: {
    width: "100%",
    alignSelf: "center",
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardSubtle: {
    backgroundColor: colors.surface2,
    shadowOpacity: 0,
    elevation: 0,
  },
  button: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  buttonSmall: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  disabled: {
    opacity: 0.48,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  buttonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryText: {
    color: colors.text,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  pageHeader: {
    gap: spacing.md,
  },
  pageHeaderWide: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  pageHeaderCopy: {
    flex: 1,
    gap: 6,
  },
  pageHeaderAction: {
    flexShrink: 0,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  pageTitle: {
    color: colors.text,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  pageTitleCompact: {
    fontSize: 29,
    lineHeight: 34,
  },
  pageSubtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 760,
  },
  sectionTitleWrap: {
    gap: 3,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  sectionSubtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
});

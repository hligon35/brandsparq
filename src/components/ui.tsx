import type { PropsWithChildren, ReactNode } from "react";
import { useSegments } from "expo-router";
import {
  Platform,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
  type ListRenderItem,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, shadows, spacing } from "@/theme/tokens";

export function Screen({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const responsive = useResponsive();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <View
        style={[
          styles.screenInner,
          {
            maxWidth: responsive.maxContentWidth,
            paddingHorizontal: responsive.gutter,
            paddingTop: Math.max(responsive.compact ? spacing.md : spacing.lg, insets.top),
            paddingBottom: Math.max(responsive.compact ? spacing.md : spacing.lg, insets.bottom),
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
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const firstSegment = String(segments[0] ?? "");
  const headerlessNativeScreen =
    Platform.OS !== "web" && ["invite", "review"].includes(firstSegment);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingHorizontal: responsive.gutter,
          paddingTop: headerlessNativeScreen
            ? Math.max(responsive.compact ? spacing.md : spacing.lg, insets.top)
            : responsive.compact
              ? spacing.md
              : spacing.lg,
          paddingBottom:
            headerlessNativeScreen && firstSegment !== "(tabs)"
              ? Math.max(responsive.compact ? spacing.md : spacing.lg, insets.bottom)
              : responsive.compact
                ? spacing.md
                : spacing.lg,
        },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      {...props}
    >
      <View style={[styles.scrollInner, { maxWidth: responsive.maxContentWidth }]}>{children}</View>
    </ScrollView>
  );
}

/** One vertical virtualized surface; headers/footers share the normal page gutters. */
export function PageList<T>({
  data,
  renderItem,
  header,
  footer,
  empty,
  columns = 1,
  extraData,
  refreshing,
  onRefresh,
  keyExtractor,
}: {
  data: T[];
  renderItem: ListRenderItem<T>;
  header?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  columns?: number;
  extraData?: unknown;
  refreshing?: boolean;
  onRefresh?: () => void;
  keyExtractor(item: T, index: number): string;
}) {
  const responsive = useResponsive();
  const insets = useSafeAreaInsets();
  return (
    <FlatList
      key={`columns-${columns}`}
      style={styles.screen}
      data={data}
      numColumns={columns}
      extraData={extraData}
      keyExtractor={keyExtractor}
      refreshing={refreshing}
      onRefresh={onRefresh}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        width: "100%",
        alignSelf: "center",
        maxWidth: responsive.maxContentWidth + responsive.gutter * 2,
        paddingHorizontal: responsive.gutter,
        paddingTop: responsive.compact ? spacing.md : spacing.lg,
        paddingBottom: Math.max(responsive.compact ? spacing.md : spacing.lg, insets.bottom),
      }}
      columnWrapperStyle={columns > 1 ? { gap: spacing.md } : undefined}
      ListHeaderComponent={
        <View style={[styles.scrollInner, { paddingBottom: spacing.md }]}>{header}</View>
      }
      ListFooterComponent={footer ? <View style={styles.scrollInner}>{footer}</View> : undefined}
      ListEmptyComponent={empty ? <View style={styles.scrollInner}>{empty}</View> : undefined}
      renderItem={(info) => (
        <View style={{ flex: 1, minWidth: 0, marginBottom: spacing.md }}>{renderItem(info)}</View>
      )}
    />
  );
}

export function Card({
  children,
  style,
  subtle = false,
  accessibilityLabel,
  role,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  subtle?: boolean;
  accessibilityLabel?: string;
  role?: "group";
}>) {
  const { compact } = useResponsive();
  return (
    <View
      role={role}
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, { padding: compact ? 16 : 20 }, subtle && styles.cardSubtle, style]}
    >
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  secondary = false,
  danger = false,
  small = false,
  style,
  ...pressableProps
}: {
  label: string;
  onPress?: () => void;
  secondary?: boolean;
  danger?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      {...pressableProps}
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
        style,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText, { textAlign: "center" }]}>
        {label}
      </Text>
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
    <View style={[styles.pageHeader, styles.pageHeaderWide]}>
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
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  buttonSmall: {
    minHeight: 44,
    minWidth: 44,
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
    fontWeight: "700",
  },
  secondaryText: {
    color: colors.text,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 9,
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
    alignItems: "flex-start",
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
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  pageTitle: {
    color: colors.text,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  pageTitleCompact: {
    fontSize: 27,
    lineHeight: 32,
  },
  pageSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 760,
  },
  sectionTitleWrap: {
    gap: 3,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  sectionSubtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
});

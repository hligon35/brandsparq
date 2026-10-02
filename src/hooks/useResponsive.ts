import { Platform, useWindowDimensions } from "react-native";

export const breakpoints = {
  compact: 640,
  wide: 1024,
} as const;

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const compact = width < breakpoints.compact;
  const wide = width >= breakpoints.wide;
  const medium = !compact && !wide;
  const desktopWeb = Platform.OS === "web" && wide;

  return {
    width,
    height,
    compact,
    medium,
    wide,
    desktopWeb,
    gutter: compact ? 16 : medium ? 24 : 32,
    sectionGap: compact ? 18 : 24,
    maxContentWidth: 1180,
  };
}

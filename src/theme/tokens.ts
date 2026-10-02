export const colors = {
  bg: "#F4F8FF",
  bgStrong: "#EAF3FF",
  surface: "#FFFFFF",
  surface2: "#F2F7FD",
  surface3: "#E8F2FC",
  text: "#071A5D",
  textSoft: "#173A73",
  muted: "#667795",
  primary: "#0B78F6",
  primaryDark: "#0755C9",
  accent: "#0B78F6",
  cyan: "#00C9D7",
  teal: "#08C2B1",
  orange: "#FF8A00",
  amber: "#FFBD00",
  success: "#0DAF7A",
  warning: "#E89100",
  danger: "#E45261",
  border: "#DCE7F5",
  white: "#FFFFFF",
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  xl: 30,
  pill: 999,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const shadows = {
  card: {
    shadowColor: "#0A2A66",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
} as const;

import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable } from "react-native";
import { colors } from "@/theme/tokens";
export function IconButton({
  label,
  icon = "sync-outline",
  onPress,
  busy = false,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !onPress || busy, busy }}
      disabled={!onPress || busy}
      onPress={onPress}
      style={{
        width: 48,
        height: 48,
        alignItems: "center",
        justifyContent: "center",
        opacity: !onPress || busy ? 0.5 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Ionicons name={icon} size={24} color={colors.primary} />
      )}
    </Pressable>
  );
}

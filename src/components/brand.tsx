import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "@/theme/tokens";

export function BrandLogo({
  compact = false,
  showTagline = true,
}: {
  compact?: boolean;
  showTagline?: boolean;
}) {
  const markSize = compact ? 42 : 66;
  const wordSize = compact ? 25 : 40;

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.mark,
          {
            width: markSize,
            height: markSize,
            borderRadius: compact ? 13 : 18,
          },
        ]}
      >
        <View style={styles.speedOne} />
        <View style={styles.speedTwo} />
        <Ionicons
          name="image-outline"
          size={compact ? 23 : 36}
          color={colors.white}
        />
        <View style={styles.heartBubble}>
          <Ionicons
            name="heart"
            size={compact ? 8 : 11}
            color={colors.white}
          />
        </View>
        <Ionicons
          name="sparkles"
          size={compact ? 14 : 20}
          color={colors.orange}
          style={styles.spark}
        />
      </View>

      <View style={styles.wordWrap}>
        <View style={styles.wordmark}>
          <Text style={[styles.brandText, { fontSize: wordSize }]}>Brand</Text>
          <Text style={[styles.sparText, { fontSize: wordSize }]}>Spar</Text>
          <Text style={[styles.qText, { fontSize: wordSize }]}>Q</Text>
        </View>
        {showTagline && (
          <Text style={[styles.tagline, compact && styles.taglineCompact]}>
            CREATE. CAPTION. POST.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  mark: {
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "visible",
  },
  speedOne: {
    position: "absolute",
    width: 18,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.cyan,
    left: -11,
    top: "35%",
  },
  speedTwo: {
    position: "absolute",
    width: 12,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    left: -7,
    top: "57%",
  },
  heartBubble: {
    position: "absolute",
    right: -5,
    top: 5,
    width: 18,
    height: 18,
    borderRadius: 6,
    backgroundColor: colors.cyan,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.white,
  },
  spark: {
    position: "absolute",
    right: -12,
    top: -11,
  },
  wordWrap: {
    gap: 1,
  },
  wordmark: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  brandText: {
    color: colors.text,
    fontWeight: "900",
    letterSpacing: -1.5,
  },
  sparText: {
    color: colors.primary,
    fontWeight: "900",
    letterSpacing: -1.5,
  },
  qText: {
    color: colors.orange,
    fontWeight: "900",
    letterSpacing: -1.5,
  },
  tagline: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 3.1,
    marginLeft: 2,
  },
  taglineCompact: {
    fontSize: 7,
    letterSpacing: 1.8,
  },
});

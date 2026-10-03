import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme/tokens";

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
      <Image
        source={require("../../assets/brandsparqLogo.png")}
        style={{ width: markSize, height: markSize }}
        resizeMode="contain"
      />

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

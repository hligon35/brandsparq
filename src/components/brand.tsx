import { Image, StyleSheet, View } from "react-native";

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.wrap}>
      <Image
        accessibilityLabel="BrandSparQ"
        accessibilityRole="image"
        source={require("../../assets/brandsparqLogo.png")}
        style={[styles.logo, compact && styles.compact]}
        resizeMode="contain"
      />
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: { flexShrink: 1, maxWidth: "100%" },
  logo: { width: 290, maxWidth: "100%", height: 100 },
  compact: { width: 174, height: 60 },
});

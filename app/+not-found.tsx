import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Button, Card, PageScroll } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <PageScroll contentStyle={styles.page}>
      <View style={styles.wrap}>
        <Card style={styles.card}>
          <Text style={styles.code}>404</Text>
          <Text style={styles.title}>That page isn’t here.</Text>
          <Text style={styles.copy}>
            The link may be outdated, or the BrandSparQ workspace has moved.
          </Text>
          <Button label="Back to BrandSparQ" onPress={() => router.replace("/")} />
        </Card>
      </View>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  page: { justifyContent: "center" },
  wrap: { width: "100%", maxWidth: 520, alignSelf: "center" },
  card: { alignItems: "center", padding: spacing.xl },
  code: { color: colors.primary, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
  title: { color: colors.text, fontSize: 28, fontWeight: "900", textAlign: "center" },
  copy: { color: colors.muted, lineHeight: 22, textAlign: "center", marginBottom: spacing.sm },
});

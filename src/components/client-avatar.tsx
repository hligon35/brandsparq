import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme/tokens";
import type { Client } from "@/types/domain";

export function ClientAvatar({ client }: { client: Client }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [client.profileImageUrl]);
  const initials =
    client.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] || "")
      .join("")
      .toUpperCase() || "?";
  return (
    <View style={[styles.avatar, { backgroundColor: client.color || colors.primary }]}>
      {client.profileImageUrl && !failed ? (
        <Image
          accessibilityLabel={`${client.name} account profile image`}
          source={{ uri: client.profileImageUrl }}
          style={styles.image}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text accessibilityLabel={`${client.name} initials`} style={styles.initials}>
          {initials}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: "100%", height: "100%" },
  initials: { color: colors.white, fontWeight: "800", fontSize: 22 },
});

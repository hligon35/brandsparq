import { useEffect, useMemo, useState } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/context";
import { api } from "@/api/client";
import { colors } from "@/theme/tokens";

export function AssetThumbnail({ assetId, label }: { assetId: string; label: string }) {
  const { user } = useAuth();
  const [uri, setUri] = useState("");
  const [failed, setFailed] = useState(false);
  const nativeSource = useMemo(
    () => (Platform.OS !== "web" && user ? api.assetImageSource(assetId) : undefined),
    [assetId, user?.id],
  );
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    setUri("");
    setFailed(false);
    if (Platform.OS !== "web") return () => controller.abort();
    void api
      .getAssetImage(assetId, controller.signal)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUri(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, user?.id]);
  return (
    <View style={styles.frame}>
      {(nativeSource || uri) && !failed ? (
        <Image
          accessibilityLabel={label}
          key={`${user?.id}:${assetId}`}
          source={nativeSource || { uri }}
          resizeMethod="resize"
          resizeMode="contain"
          style={styles.image}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={styles.placeholder}>
          {failed ? "Preview unavailable" : "Loading preview…"}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: {
    width: 88,
    height: 88,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  image: { width: "100%", height: "100%" },
  placeholder: { color: colors.muted, fontSize: 11, textAlign: "center" },
});

import { useEffect, useState } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/context";
import { api } from "@/api/client";
import { colors } from "@/theme/tokens";

export function AssetThumbnail({ assetId, label }: { assetId: string; label: string }) {
  const { user } = useAuth();
  const [uri, setUri] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    let reader: FileReader | undefined;
    const controller = new AbortController();
    setUri("");
    setFailed(false);
    void api
      .getAssetImage(assetId, controller.signal)
      .then((blob) => {
        if (!active) return;
        if (Platform.OS === "web") {
          objectUrl = URL.createObjectURL(blob);
          setUri(objectUrl);
        } else {
          reader = new FileReader();
          reader.onload = () => {
            if (active && typeof reader?.result === "string") setUri(reader.result);
          };
          reader.onerror = () => {
            if (active) setFailed(true);
          };
          reader.readAsDataURL(blob);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
      if (reader?.readyState === 1) reader.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, user?.id]);
  return (
    <View style={styles.frame}>
      {uri && !failed ? (
        <Image
          accessibilityLabel={label}
          source={{ uri }}
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

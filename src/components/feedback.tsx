import { useEffect, useState } from "react";
import { Alert as NativeAlert, Modal, Platform, StyleSheet, Text, View } from "react-native";
import { Button } from "./ui";
import { colors, radius, spacing } from "@/theme/tokens";

type Notice = { title: string; message?: string };
let showNotice: ((notice: Notice) => void) | undefined;
const pending: Notice[] = [];

// React Native Web's Alert is empty; use one visible application dialog on web.
export const Alert = {
  alert(title: string, message?: string) {
    if (Platform.OS === "web") {
      if (showNotice) showNotice({ title, message });
      else pending.push({ title, message });
    } else NativeAlert.alert(title, message);
  },
};

export function FeedbackHost() {
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    showNotice = (notice) => setNotices((current) => [...current, notice]);
    for (const notice of pending.splice(0)) showNotice(notice);
    return () => {
      showNotice = undefined;
    };
  }, []);
  const notice = notices[0];
  const dismiss = () => setNotices((current) => current.slice(1));
  if (Platform.OS !== "web" || !notice) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.dialog} accessibilityRole="alert" accessibilityLabel={notice.title}>
          <Text accessibilityRole="header" style={styles.title}>
            {notice.title}
          </Text>
          {!!notice.message && <Text style={styles.message}>{notice.message}</Text>}
          <Button label="Close message" onPress={dismiss} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
    backgroundColor: "rgba(7,27,51,0.6)",
  },
  dialog: {
    width: "100%",
    maxWidth: 480,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "900" },
  message: { color: colors.textSoft, fontSize: 16, lineHeight: 24 },
});

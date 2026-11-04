import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { Card } from "./ui";
import { confirmAction } from "./feedback";
import { colors } from "@/theme/tokens";
import { createUpdateController, type UpdateSnapshot } from "@/updates/controller";

type Props = { beforeRestart(): Promise<boolean>; disabled?: boolean };
export function AppUpdateControl(props: Props) {
  return Platform.OS === "web" ? (
    <WebUpdateControl {...props} />
  ) : (
    <NativeUpdateControl {...props} />
  );
}

function WebUpdateControl({ beforeRestart, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function refresh() {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    try {
      if (
        await confirmAction(
          "Refresh web app?",
          "Reload this page to load the latest deployed web app.",
          "Refresh",
        )
      )
        if (await beforeRestart()) window.location.reload();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Card>
      <View style={styles.row}>
        <Ionicons name="cloud-download-outline" size={24} color={colors.primary} />
        <View style={styles.copy}>
          <Text style={styles.title}>App updates</Text>
          <Text style={styles.meta}>Refresh the web app to load the latest deployed version.</Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh web app"
        accessibilityState={{ disabled: !!disabled || busy }}
        disabled={disabled || busy}
        onPress={() => void refresh()}
        style={styles.link}
      >
        <Text style={styles.linkText}>Refresh web app</Text>
        <Ionicons name="arrow-forward" size={16} color={colors.primary} />
      </Pressable>
    </Card>
  );
}

function NativeUpdateControl({ beforeRestart, disabled }: Props) {
  const { isUpdatePending } = Updates.useUpdates();
  const pending = useRef(isUpdatePending);
  pending.current = isUpdatePending;
  const before = useRef(beforeRestart);
  before.current = beforeRestart;
  const enabled = !__DEV__ && Updates.isEnabled;
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>({
    phase: enabled ? "idle" : "unavailable",
    busy: false,
    ready: enabled && isUpdatePending,
    message: enabled
      ? "Get the latest compatible update for this app."
      : "App updates require an update-enabled standalone build.",
  });
  const controller = useRef<ReturnType<typeof createUpdateController> | null>(null);
  if (!controller.current)
    controller.current = createUpdateController({
      enabled: () => enabled,
      pending: () => pending.current,
      check: () => Updates.checkForUpdateAsync(),
      download: () => Updates.fetchUpdateAsync(),
      reload: () => Updates.reloadAsync(),
      confirmRestart: () =>
        confirmAction(
          "Restart and update?",
          "BrandSparQ will restart to apply the downloaded update. Save your work before continuing.",
          "Restart and update",
          "Later",
        ),
      beforeRestart: () => before.current(),
      changed: setSnapshot,
    });
  useEffect(() => {
    if (isUpdatePending) controller.current?.markReady();
  }, [isUpdatePending]);
  useEffect(() => () => controller.current?.dispose(), []);
  const label = snapshot.busy
    ? snapshot.phase === "downloading"
      ? "Downloading update…"
      : snapshot.phase === "applying"
        ? "Applying update…"
        : snapshot.phase === "ready"
          ? "Preparing restart…"
          : "Checking update…"
    : snapshot.ready
      ? "Restart and update"
      : "Check for app update";
  const blocked = disabled || snapshot.busy || !enabled;
  return (
    <Card>
      <View style={styles.row}>
        <Ionicons name="cloud-download-outline" size={24} color={colors.primary} />
        <View style={styles.copy}>
          <Text style={styles.title}>App updates</Text>
          <Text style={styles.meta}>
            Version {Constants.expoConfig?.version || "—"}
            {Updates.channel ? ` · ${Updates.channel}` : ""}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!blocked, busy: snapshot.busy }}
        disabled={blocked}
        onPress={() =>
          void (snapshot.ready ? controller.current?.apply() : controller.current?.check())
        }
        style={[styles.link, blocked && { opacity: 0.6 }]}
      >
        {snapshot.busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons
            name={snapshot.ready ? "refresh" : "download-outline"}
            size={18}
            color={colors.primary}
          />
        )}
        <Text style={styles.linkText}>{label}</Text>
      </Pressable>
      <Text
        accessibilityRole={snapshot.phase === "error" ? "alert" : undefined}
        accessibilityLiveRegion="polite"
        style={styles.meta}
      >
        {snapshot.message}
      </Text>
    </Card>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 16, fontWeight: "800", color: colors.text },
  meta: { fontSize: 12, lineHeight: 18, color: colors.muted },
  link: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: "700", flexShrink: 1 },
});

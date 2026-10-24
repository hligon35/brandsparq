import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Alert } from "@/components/feedback";
import { api } from "@/api/client";
import { notificationRoute } from "@/shared/notification-route";
import { IconButton } from "@/components/icon-button";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors } from "@/theme/tokens";

export default function NotificationsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    try {
      setItems((await api.getNotifications()).data);
    } catch (e) {
      Alert.alert("Unable to load notifications", e instanceof Error ? e.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const unread = items.filter((item) => !item.read_at).length;
  const visible = useMemo(
    () =>
      items.filter((item) =>
        filter === "unread"
          ? !item.read_at
          : filter === "failed"
            ? ["failed", "partial"].includes(item.status)
            : true,
      ),
    [items, filter],
  );
  async function open(item: any) {
    if (busy) return;
    setBusy(true);
    try {
      await api.markNotificationRead(item.id);
      setItems((old) =>
        old.map((row) =>
          row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row,
        ),
      );
      const route = notificationRoute(item);
      if (route) router.push(route as Href);
    } catch (e) {
      Alert.alert("Unable to open notification", e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api.deleteNotifications(selected);
      setItems((old) => old.filter((item) => !selected.includes(item.id)));
      setSelected([]);
    } catch (e) {
      Alert.alert("Unable to delete notifications", e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function markAll() {
    setBusy(true);
    try {
      await api.markAllNotificationsRead();
      await load();
    } catch (e) {
      Alert.alert(
        "Unable to mark notifications read",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const allSelected = visible.length > 0 && visible.every((item) => selected.includes(item.id));
  return (
    <PageScroll>
      <PageHeader
        title="Notifications"
        subtitle={`${unread} new · Tap a notification to open it.`}
        action={<IconButton label="Refresh notifications" busy={loading} onPress={load} />}
      />
      <View style={styles.toolbar}>
        {["all", "unread", "failed"].map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === value }}
            onPress={() => setFilter(value)}
            style={[styles.filter, filter === value && styles.active]}
          >
            <Text style={{ color: filter === value ? colors.white : colors.text }}>
              {value === "unread" ? "New" : value === "failed" ? "Issues" : "All"}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.toolbar}>
        <Button
          label={allSelected ? "Deselect all" : "Select all"}
          small
          secondary
          onPress={
            busy || !visible.length
              ? undefined
              : () =>
                  setSelected((old) =>
                    allSelected
                      ? old.filter((id) => !visible.some((item) => item.id === id))
                      : [...new Set([...old, ...visible.map((item) => item.id)])],
                  )
          }
        />
        {!!selected.length && (
          <Button
            label={`Delete (${selected.length})`}
            small
            danger
            onPress={busy ? undefined : remove}
          />
        )}{" "}
        {!!unread && (
          <Button label="Mark all read" small secondary onPress={busy ? undefined : markAll} />
        )}
      </View>
      {visible.map((item) => (
        <Card key={item.id} style={!item.read_at ? styles.newCard : undefined}>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`Select ${item.title || item.type}`}
              accessibilityState={{ checked: selected.includes(item.id), disabled: busy }}
              disabled={busy}
              onPress={() =>
                setSelected((old) =>
                  old.includes(item.id) ? old.filter((id) => id !== item.id) : [...old, item.id],
                )
              }
              style={styles.checkbox}
            >
              <Ionicons
                name={selected.includes(item.id) ? "checkbox" : "square-outline"}
                color={colors.primary}
                size={26}
              />
            </Pressable>
            {!item.read_at && <Text style={styles.newText}>NEW</Text>}
            <StatusBadge label={item.status || "sent"} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title || item.type}`}
            disabled={busy}
            onPress={() => open(item)}
            style={styles.notice}
          >
            <Text style={styles.title}>{item.title || item.type}</Text>
            {!!item.body && <Text style={styles.body}>{item.body}</Text>}
            <Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text>
            {!!item.error_message && <Text style={styles.error}>{item.error_message}</Text>}
            {!!notificationRoute(item) && <Text style={styles.newText}>View details →</Text>}
          </Pressable>
          {!!item.deliveries?.length && (
            <Text style={styles.time}>
              {item.deliveries.map((d: any) => `${d.channel}: ${d.status}`).join(" · ")}
            </Text>
          )}
        </Card>
      ))}
      {!visible.length && (
        <Card>
          <Text style={styles.body}>
            {loading ? "Loading notifications…" : "No notifications in this view."}
          </Text>
        </Card>
      )}
    </PageScroll>
  );
}
const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: {
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  active: { backgroundColor: colors.primary },
  newCard: { borderColor: colors.primary, borderWidth: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  checkbox: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  check: { fontSize: 26, color: colors.primary },
  newText: { color: colors.primary, fontWeight: "800", fontSize: 12 },
  notice: { gap: 10, minHeight: 48 },
  title: { color: colors.text, fontWeight: "800", fontSize: 17 },
  body: { color: colors.muted, lineHeight: 22 },
  time: { color: colors.muted, fontSize: 12, lineHeight: 20 },
  error: { color: colors.danger },
});

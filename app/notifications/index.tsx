import { useInbox } from "@/notifications/inbox";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Alert } from "@/components/feedback";
import { api } from "@/api/client";
import { notificationRoute } from "@/shared/notification-route";
import { IconButton } from "@/components/icon-button";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors } from "@/theme/tokens";

export default function NotificationsScreen() {
  const router = useRouter();
  const { refresh: refreshInbox } = useInbox();
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const version = useRef(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  async function load(more = false) {
    const current = ++version.current;
    setLoading(true);
    try {
      const result = await api.getNotifications({
        search: query,
        filter,
        ...(more && nextCursor ? { cursor: nextCursor } : {}),
      });
      if (current !== version.current) return;
      setItems((old) =>
        more
          ? [...old, ...result.data.filter((row) => !old.some((item) => item.id === row.id))]
          : result.data,
      );
      setNextCursor(result.nextCursor);
      setUnreadCount(result.unreadCount);
      void refreshInbox();
      if (!more) setSelected([]);
    } catch (e) {
      Alert.alert("Unable to load notifications", e instanceof Error ? e.message : "Try again.");
    } finally {
      if (current === version.current) setLoading(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => {
      clearTimeout(timer);
      version.current++;
    };
  }, [query, filter]);
  const unread = unreadCount;
  const visible = items;
  async function open(item: any) {
    if (busy) return;
    setBusy(true);
    const route = notificationRoute(item);
    if (route) router.push(route as Href);
    try {
      await api.markNotificationRead(item.id);
      setItems((old) =>
        filter === "unread"
          ? old.filter((row) => row.id !== item.id)
          : old.map((row) =>
              row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row,
            ),
      );
      setSelected((old) => old.filter((id) => id !== item.id));
      void refreshInbox();
      setUnreadCount((old) => Math.max(0, old - Number(!item.read_at)));
    } catch {
      Alert.alert(
        "Read status not saved",
        "The notification remains new. You can still open its destination and retry marking it read later.",
      );
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
      await load();
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
        action={
          <IconButton label="Refresh notifications" busy={loading} onPress={() => void load()} />
        }
      />
      <TextInput
        accessibilityLabel="Search notifications"
        placeholder="Search notifications"
        value={query}
        onChangeText={setQuery}
        style={{
          minHeight: 48,
          padding: 12,
          color: colors.text,
          backgroundColor: colors.surface,
          borderRadius: 12,
        }}
      />
      <Text style={styles.time}>Select all selects this loaded list (up to 100 at a time).</Text>
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
                      : [...new Set([...old, ...visible.map((item) => item.id)])].slice(0, 100),
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
                  old.includes(item.id)
                    ? old.filter((id) => id !== item.id)
                    : [...old, item.id].slice(0, 100),
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
      {!!nextCursor && (
        <Button
          label={loading ? "Loading…" : "Load more notifications"}
          secondary
          onPress={loading ? undefined : () => void load(true)}
        />
      )}
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

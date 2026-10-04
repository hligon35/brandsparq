import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

const platforms = ["instagram", "facebook", "linkedin", "tiktok", "x"];

function expiryLabel(value?: number | null) {
  if (!value) return "No expiry reported";
  const diff = value - Date.now();
  if (diff <= 0) return "Token expired";
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return `Token expires in ${days} day${days === 1 ? "" : "s"}`;
}

export default function SocialConnectionsScreen() {
  const [clients, setClients] = useState<any[]>([]);
  const [clientId, setClientId] = useState("");
  const [accounts, setAccounts] = useState<any[]>([]);
  const [workingId, setWorkingId] = useState("");

  async function load() {
    try {
      const c = await api.getClients();
      setClients(c);
      const selected = clientId || c[0]?.id || "";
      if (!clientId && selected) setClientId(selected);
      if (selected) setAccounts((await api.getSocialAccounts(selected)).data);
    } catch (error) {
      Alert.alert(
        "Unable to load social connections",
        error instanceof Error ? error.message : "Try again.",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!clientId) return;
    api
      .getSocialAccounts(clientId)
      .then((r) => setAccounts(r.data))
      .catch((error) =>
        Alert.alert(
          "Unable to load social connections",
          error instanceof Error ? error.message : "Try again.",
        ),
      );
  }, [clientId]);

  async function connect(platformName: string) {
    if (!clientId) return;
    const returnTo =
      Platform.OS === "web" ? `${window.location.origin}/social` : Linking.createURL("/social");
    const url = api.getSocialConnectUrl(platformName, clientId, returnTo);
    if (Platform.OS === "web") {
      window.location.assign(url);
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(url, returnTo);
    if (result.type === "success") {
      await load();
      return;
    }
    if (result.type !== "cancel" && result.type !== "dismiss") {
      Alert.alert(
        "Connection incomplete",
        "The social provider did not return a completed authorization.",
      );
    }
  }

  async function verify(id: string) {
    setWorkingId(id);
    try {
      await api.verifySocialAccount(id);
      await load();
    } catch (error) {
      Alert.alert(
        "Connection needs attention",
        error instanceof Error ? error.message : "Verification failed.",
      );
      await load();
    } finally {
      setWorkingId("");
    }
  }

  async function disconnect(id: string) {
    setWorkingId(id);
    try {
      await api.disconnectSocialAccount(id);
      await load();
    } catch (error) {
      Alert.alert("Unable to disconnect", error instanceof Error ? error.message : "Try again.");
    } finally {
      setWorkingId("");
    }
  }

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Publishing destinations"
        title="Social connections"
        subtitle="Connect, verify, and monitor each client's publishing destinations."
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh social connections"
            onPress={load}
          >
            <Text style={styles.refresh}>Refresh</Text>
          </Pressable>
        }
      />

      <Card>
        <Text style={styles.label}>Client</Text>
        <View style={styles.chips}>
          {clients.map((client) => (
            <Pressable
              key={client.id}
              accessibilityRole="button"
              accessibilityState={{ selected: client.id === clientId }}
              accessibilityLabel={`Select client ${client.name}`}
              onPress={() => setClientId(client.id)}
              style={[styles.chip, client.id === clientId && styles.chipActive]}
            >
              <Text style={[styles.chipText, client.id === clientId && styles.chipTextActive]}>
                {client.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <View style={styles.grid}>
        {platforms.map((platformName) => {
          const existing = accounts.filter((a) => a.platform === platformName);
          return (
            <Card key={platformName} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.title}>
                  {platformName === "x"
                    ? "X"
                    : platformName[0].toUpperCase() + platformName.slice(1)}
                </Text>
                <StatusBadge label={existing.length ? "connected" : "disconnected"} />
              </View>

              {existing.map((account) => {
                const unhealthy =
                  account.status === "reauth_required" ||
                  account.health_status === "reauth_required";
                const degraded = account.health_status === "degraded";
                const status = unhealthy
                  ? "reauth required"
                  : degraded
                    ? "degraded"
                    : account.health_status || account.status;
                return (
                  <View key={account.id} style={styles.account}>
                    <View style={styles.row}>
                      <Text style={styles.accountName}>{account.account_name}</Text>
                      <StatusBadge label={status} />
                    </View>
                    <Text style={styles.meta}>
                      {account.account_type || account.external_account_id}
                    </Text>
                    <Text style={styles.meta}>{expiryLabel(account.token_expires_at)}</Text>
                    {!!account.health_checked_at && (
                      <Text style={styles.meta}>
                        Checked {new Date(account.health_checked_at).toLocaleString()}
                      </Text>
                    )}
                    {!!account.last_error && (
                      <Text style={styles.warning}>{account.last_error}</Text>
                    )}
                    <View style={styles.actions}>
                      <Button
                        label={workingId === account.id ? "Checking…" : "Verify"}
                        secondary
                        small
                        onPress={workingId ? undefined : () => verify(account.id)}
                      />
                      {unhealthy && (
                        <Button label="Reconnect" small onPress={() => connect(platformName)} />
                      )}
                      <Button
                        label="Disconnect"
                        secondary
                        small
                        onPress={workingId ? undefined : () => disconnect(account.id)}
                      />
                    </View>
                  </View>
                );
              })}

              {!existing.length && <Text style={styles.meta}>No account connected.</Text>}
              <Button
                label={existing.length ? "Connect another" : "Connect"}
                onPress={() => connect(platformName)}
              />
            </Card>
          );
        })}
      </View>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  refresh: { color: colors.primary, fontWeight: "800" },
  label: { color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.surface2,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.textSoft, fontWeight: "700" },
  chipTextActive: { color: colors.white },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: { flexGrow: 1, flexBasis: 300, maxWidth: "100%", minHeight: 230 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 19, fontWeight: "900" },
  account: { gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  accountName: { color: colors.text, fontWeight: "800", flex: 1 },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
});

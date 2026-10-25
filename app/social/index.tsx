import { useCapabilities } from "@/auth/capabilities";
import { Alert } from "@/components/feedback";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { IconButton } from "@/components/icon-button";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

const icons: Record<string, number> = {
  instagram: require("../../assets/Instagram.png"),
  facebook: require("../../assets/Facebook.png"),
  linkedin: require("../../assets/LinkedIn.png"),
  tiktok: require("../../assets/TikTok.png"),
  x: require("../../assets/X.png"),
};
const platforms = ["instagram", "facebook", "linkedin", "tiktok", "x"];

function expiryLabel(value?: number | null) {
  if (!value) return "No expiry reported";
  const diff = value - Date.now();
  if (diff <= 0) return "Token expired";
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return `Token expires in ${days} day${days === 1 ? "" : "s"}`;
}

export default function SocialConnectionsScreen() {
  const can = useCapabilities();
  const { social_error: callbackError } = useLocalSearchParams<{ social_error?: string }>();
  const [clients, setClients] = useState<any[]>([]);
  const [clientId, setClientId] = useState("");
  const [accounts, setAccounts] = useState<any[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState("");

  useEffect(() => {
    if (callbackError) Alert.alert("Social connection failed", callbackError);
  }, [callbackError]);

  async function load() {
    try {
      const c = await api.getClients();
      setClients(c);
      const selected = clientId || c[0]?.id || "";
      if (!clientId && selected) setClientId(selected);
      setRefreshVersion((value) => value + 1);
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
    setAccounts([]);
    setExpanded(null);
    if (!clientId) return;
    let active = true;
    api
      .getSocialAccounts(clientId)
      .then((r) => {
        if (active) setAccounts(r.data);
      })
      .catch(
        (error) =>
          active &&
          Alert.alert(
            "Unable to load social connections",
            error instanceof Error ? error.message : "Try again.",
          ),
      );
    return () => {
      active = false;
    };
  }, [clientId, refreshVersion]);

  async function connect(platformName: string) {
    if (!clientId) return;
    const returnTo =
      Platform.OS === "web" ? `${window.location.origin}/social` : Linking.createURL("/social");
    setWorkingId(platformName);
    try {
      const { authorizationUrl: url } = await api.startSocialConnection(
        platformName,
        clientId,
        returnTo,
      );
      if (Platform.OS === "web") {
        window.location.assign(url);
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(url, returnTo);
      if (result.type === "success") {
        const error = Linking.parse(result.url).queryParams?.social_error;
        if (error) throw new Error(String(error));
        await load();
        return;
      }
      if (result.type !== "cancel" && result.type !== "dismiss") {
        Alert.alert(
          "Connection incomplete",
          "The social provider did not return a completed authorization.",
        );
      }
    } catch (error) {
      Alert.alert("Unable to connect", error instanceof Error ? error.message : "Try again.");
    } finally {
      setWorkingId("");
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
        action={<IconButton label="Refresh social connections" onPress={load} />}
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
          const connected = existing.some(
            (account) =>
              account.status === "connected" &&
              !["reauth_required", "degraded", "disconnected"].includes(account.health_status) &&
              (!account.token_expires_at || Number(account.token_expires_at) > Date.now()),
          );
          return (
            <Card key={platformName} style={styles.card}>
              <Image
                source={icons[platformName]}
                resizeMode="contain"
                accessibilityLabel={platformName}
                style={[
                  styles.platformIcon,
                  Platform.OS === "web"
                    ? {
                        filter: `drop-shadow(0px 0px 10px ${connected ? "rgba(13,175,122,0.8)" : "rgba(228,82,97,0.8)"})`,
                      }
                    : {
                        shadowColor: connected ? colors.success : colors.danger,
                        shadowOpacity: 0.85,
                        shadowRadius: 16,
                        shadowOffset: { width: 0, height: 0 },
                      },
                ]}
              />
              <Text style={styles.title}>
                {platformName === "x" ? "X" : platformName[0].toUpperCase() + platformName.slice(1)}
              </Text>
              {connected ? (
                <Text style={styles.connected}>Connected</Text>
              ) : (
                <Button
                  label={workingId === platformName ? "Connecting…" : "Connect"}
                  onPress={
                    workingId || !clientId || !can("social_manage", clientId)
                      ? undefined
                      : () => connect(platformName)
                  }
                />
              )}
              {!!existing.length && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Manage ${platformName} accounts`}
                  accessibilityState={{ expanded: expanded === platformName }}
                  onPress={() => setExpanded(expanded === platformName ? null : platformName)}
                  style={styles.manage}
                >
                  <Text style={styles.meta}>Manage accounts</Text>
                </Pressable>
              )}
              {expanded === platformName && (
                <View style={{ width: "100%" }}>
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
                        {can("social_manage", clientId) && (
                          <View style={styles.actions}>
                            <Button
                              label={workingId === account.id ? "Checking…" : "Verify"}
                              secondary
                              small
                              onPress={workingId ? undefined : () => verify(account.id)}
                            />
                            {unhealthy && (
                              <Button
                                label="Reconnect"
                                small
                                onPress={workingId ? undefined : () => connect(platformName)}
                              />
                            )}
                            <Button
                              label="Disconnect"
                              secondary
                              small
                              onPress={workingId ? undefined : () => disconnect(account.id)}
                            />
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {can("social_manage", clientId) && (
                    <Button
                      label="Connect another"
                      secondary
                      small
                      onPress={workingId ? undefined : () => connect(platformName)}
                    />
                  )}
                </View>
              )}
            </Card>
          );
        })}
      </View>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  iconGlow: {
    width: 76,
    height: 76,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  platformIcon: { width: 64, height: 64, overflow: "visible" },
  connected: {
    color: colors.success,
    fontWeight: "800",
    minHeight: 48,
    textAlignVertical: "center",
  },
  manage: { minHeight: 44, justifyContent: "center" },
  refreshButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  refresh: { color: colors.primary, fontWeight: "800" },
  label: { color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    minHeight: 44,
    paddingVertical: 11,
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: colors.surface2,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.textSoft, fontWeight: "700" },
  chipTextActive: { color: colors.white },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: "4%", rowGap: 12 },
  card: { width: "48%", padding: 12, minWidth: 0, alignItems: "center", gap: 14 },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
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

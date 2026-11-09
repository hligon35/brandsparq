import { useFocusedRefresh } from "@/hooks/useFocusedRefresh";
import { useCapabilities } from "@/auth/capabilities";
import { useAuth } from "@/auth/context";
import { Alert, confirmAction } from "@/components/feedback";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ClientPicker } from "@/components/client-picker";
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

function isConnected(account: any) {
  return (
    account.status === "connected" &&
    !["reauth_required", "degraded", "disconnected"].includes(account.health_status) &&
    (!account.token_expires_at || Number(account.token_expires_at) > Date.now())
  );
}

function expiryLabel(value?: number | null) {
  if (!value) return "No expiry reported";
  const diff = value - Date.now();
  if (diff <= 0) return "Token expired";
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return `Token expires in ${days} day${days === 1 ? "" : "s"}`;
}

export default function SocialConnectionsScreen() {
  const can = useCapabilities();
  const { user } = useAuth();
  const {
    social_error: callbackError,
    social_connected: callbackConnected,
    connected_accounts: connectedAccounts,
    connected_clients: connectedClients,
    instagram_accounts: connectedInstagram,
    clientId: requestedClient,
  } = useLocalSearchParams<{
    social_error?: string;
    social_connected?: string;
    connected_accounts?: string;
    connected_clients?: string;
    instagram_accounts?: string;
    clientId?: string;
  }>();
  const [clients, setClients] = useState<any[]>([]);
  const [clientId, setClientId] = useState(requestedClient || "");
  const [accounts, setAccounts] = useState<any[]>([]);
  const [importClients, setImportClients] = useState(user?.role === "owner");
  const [loading, setLoading] = useState(true);
  const loadVersion = useRef(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState("");

  useEffect(() => {
    if (callbackError) Alert.alert("Social connection failed", callbackError);
  }, [callbackError]);

  useEffect(() => {
    if (requestedClient) setClientId(requestedClient);
  }, [requestedClient]);

  async function load(preferredClient?: string, isCurrent = refresh.active) {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const c = await api.getClients();
      const preferred = preferredClient ?? clientId;
      const selected = c.some((item) => item.id === preferred) ? preferred : c[0]?.id || "";
      const result = selected ? await api.getSocialAccounts(selected) : { data: [] };
      if (version !== loadVersion.current || !isCurrent()) return;
      setClients(c);
      setClientId(selected);
      setAccounts(result.data);
    } catch (error) {
      if (version !== loadVersion.current || !isCurrent()) return;
      Alert.alert(
        "Unable to load social connections",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      if (version === loadVersion.current && isCurrent()) setLoading(false);
    }
  }

  const refresh = useFocusedRefresh(
    (context) => load(clientId, context.current),
    [clientId, callbackConnected],
  );

  async function connect(platformName: string) {
    const importing =
      importClients && user?.role === "owner" && ["facebook", "instagram"].includes(platformName);
    if (!clientId && !importing) return;
    const returnTo =
      Platform.OS === "web"
        ? `${window.location.origin}/social?clientId=${encodeURIComponent(clientId)}`
        : Linking.createURL("/social", { queryParams: { clientId } });
    setWorkingId(platformName);
    try {
      const { authorizationUrl: url } = await api.startSocialConnection(
        platformName,
        clientId,
        returnTo,
        importing,
      );
      if (Platform.OS === "web") {
        window.location.assign(url);
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(url, returnTo);
      if (result.type === "success") {
        const error = Linking.parse(result.url).queryParams?.social_error;
        if (error) {
          const partialClient = Linking.parse(result.url).queryParams?.clientId;
          await load(typeof partialClient === "string" ? partialClient : undefined);
          throw new Error(String(error));
        }
        const connectedClient = Linking.parse(result.url).queryParams?.clientId;
        await load(typeof connectedClient === "string" ? connectedClient : undefined);
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

  async function makeDefault(id: string) {
    setWorkingId(id);
    try {
      await api.setDefaultSocialAccount(id);
      await load();
    } catch (error) {
      Alert.alert(
        "Unable to change default",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setWorkingId("");
    }
  }
  async function disconnect(id: string) {
    const account = accounts.find((item) => item.id === id);
    const client = clients.find((item) => item.id === clientId);
    if (
      !(await confirmAction(
        "Disconnect social account?",
        `Disconnect ${account?.account_name || account?.platform || "this account"} from ${client?.name || "this client"}? Posts will need a connected destination before publishing.`,
        "Disconnect",
      ))
    )
      return;
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

  const connectedPlatforms = platforms.filter((platform) =>
    accounts.some((account) => account.platform === platform && isConnected(account)),
  ).length;

  function selectClient(id: string) {
    if (id === clientId) return;
    loadVersion.current++;
    setAccounts([]);
    setExpanded(null);
    setLoading(true);
    setClientId(id);
  }

  return (
    <PageScroll>
      <PageHeader
        title="Social connections"
        subtitle="Connect and manage your clients’ publishing destinations."
        action={
          <IconButton
            label="Refresh social connections"
            onPress={workingId ? undefined : () => load()}
            busy={loading}
          />
        }
      />

      <View style={styles.clientSection}>
        {callbackConnected && !callbackError && (
          <Text
            accessibilityRole="status"
            accessibilityLiveRegion="polite"
            style={styles.connected}
          >
            {connectedAccounts
              ? `Connected ${connectedAccounts} accounts across ${connectedClients || "1"} clients.`
              : "Connection completed. Account status is shown below."}
          </Text>
        )}
        {callbackConnected === "meta" && !callbackError && connectedInstagram === "0" && (
          <Text style={styles.warning}>
            Facebook connected, but Meta did not return a linked Instagram account. Link your
            professional Instagram account to its Facebook Page and grant access to both before
            reconnecting.
          </Text>
        )}
        {loading && (
          <Text accessibilityLiveRegion="polite" style={styles.meta}>
            Loading social connections…
          </Text>
        )}
        {!!clients.length && (
          <ClientPicker
            clients={clients}
            value={clientId}
            onChange={selectClient}
            disabled={loading || !!workingId}
          />
        )}
        {!loading && !clients.length && (
          <Card subtle>
            <Text style={styles.meta}>
              Connect Facebook or Instagram to create your first client, or add a client from
              Clients.
            </Text>
          </Card>
        )}
      </View>

      <View style={styles.listSummary}>
        <Text style={styles.meta}>Your platforms</Text>
        <Text accessibilityLiveRegion="polite" style={loading ? styles.meta : styles.summaryCount}>
          {loading ? "Loading…" : `${connectedPlatforms} of ${platforms.length} connected`}
        </Text>
      </View>
      <View style={styles.list}>
        {platforms.map((platformName) => {
          const existing = accounts.filter((a) => a.platform === platformName);
          const connected = existing.some(isConnected);
          const preferred =
            existing.find((a) => a.is_default && isConnected(a)) ||
            existing.find(isConnected) ||
            existing[0];
          const accountSummary = loading
            ? "Loading connections…"
            : preferred
              ? `${connected ? "" : "Needs attention · "}${existing.length > 1 ? `${existing.length} accounts · ` : ""}${preferred.account_name}`
              : "No account linked";
          const platformLabel =
            platformName === "x"
              ? "X"
              : platformName === "linkedin"
                ? "LinkedIn"
                : platformName === "tiktok"
                  ? "TikTok"
                  : platformName[0].toUpperCase() + platformName.slice(1);
          return (
            <View
              key={platformName}
              style={styles.platform}
              role="group"
              accessibilityLabel={`${platformName} connections`}
            >
              <View style={styles.platformRow}>
                <Image
                  source={icons[platformName]}
                  resizeMode="contain"
                  accessibilityLabel={platformName}
                  style={[
                    styles.platformIcon,
                    Platform.OS === "web"
                      ? {
                          filter: `drop-shadow(0px 0px 9px ${connected ? "rgba(13,175,122,0.8)" : "rgba(228,82,97,0.8)"})`,
                        }
                      : {
                          shadowColor: connected ? colors.success : colors.danger,
                          shadowOpacity: 0.85,
                          shadowRadius: 12,
                          shadowOffset: { width: 0, height: 0 },
                        },
                  ]}
                />
                <Pressable
                  accessibilityRole={existing.length ? "button" : undefined}
                  accessibilityLabel={
                    existing.length ? `Manage ${platformName} accounts` : undefined
                  }
                  accessibilityState={
                    existing.length
                      ? { expanded: expanded === platformName, disabled: loading || !!workingId }
                      : undefined
                  }
                  disabled={!existing.length || loading || !!workingId}
                  onPress={() => setExpanded(expanded === platformName ? null : platformName)}
                  style={styles.platformIdentity}
                >
                  <View style={styles.identityTitle}>
                    <Text style={styles.title}>{platformLabel}</Text>
                    {!!existing.length && (
                      <Ionicons
                        name={expanded === platformName ? "chevron-up" : "chevron-down"}
                        size={14}
                        color={colors.muted}
                      />
                    )}
                  </View>
                  <Text style={styles.accountSummary} numberOfLines={2}>
                    {accountSummary}
                  </Text>
                </Pressable>
                <View style={styles.connectionAction}>
                  {connected ? (
                    <View style={styles.connectedStatus}>
                      <Ionicons name="checkmark" size={15} color={colors.success} />
                      <Text style={styles.connected}>Connected</Text>
                    </View>
                  ) : (
                    <Button
                      label={workingId === platformName ? "Connecting…" : "Connect"}
                      small
                      style={styles.connectButton}
                      onPress={
                        workingId ||
                        loading ||
                        (!(
                          user?.role === "owner" &&
                          importClients &&
                          ["facebook", "instagram"].includes(platformName)
                        ) &&
                          (!clientId || !can("social_manage", clientId)))
                          ? undefined
                          : () => connect(platformName)
                      }
                    />
                  )}
                </View>
              </View>
              {expanded === platformName && (
                <View style={styles.accountDetails}>
                  {existing.map((account) => {
                    const unhealthy =
                      account.status === "reauth_required" ||
                      account.health_status === "reauth_required";
                    const degraded = account.health_status === "degraded";
                    const expired =
                      !!account.token_expires_at && Number(account.token_expires_at) <= Date.now();
                    const status = expired
                      ? "expired"
                      : unhealthy
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
                        {!!account.is_default && (
                          <Text style={styles.meta}>Default publishing destination</Text>
                        )}
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
                            {!account.is_default && isConnected(account) && (
                              <Button
                                label="Make default"
                                small
                                secondary
                                onPress={workingId ? undefined : () => makeDefault(account.id)}
                              />
                            )}
                            <Button
                              label={workingId === account.id ? "Checking…" : "Verify"}
                              secondary
                              small
                              onPress={workingId ? undefined : () => verify(account.id)}
                            />
                            {!isConnected(account) && (
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
            </View>
          );
        })}
      </View>
      {user?.role === "owner" && (
        <View style={styles.importSection}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Create clients from detected Pages"
            accessibilityState={{ checked: importClients, disabled: !!workingId }}
            disabled={!!workingId}
            onPress={() => setImportClients((value) => !value)}
            style={styles.importOption}
          >
            <Ionicons
              name={importClients ? "checkbox" : "square-outline"}
              size={23}
              color={colors.primary}
            />
            <Text style={styles.importLabel}>
              Create client profiles for accounts found through Meta.
            </Text>
          </Pressable>
          <Text style={styles.meta}>
            Each Facebook Page and its linked Instagram account share one client. Existing profiles
            are reused. Turn this off to connect accounts to the selected client.
          </Text>
        </View>
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  clientSection: { gap: 10 },
  listSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryCount: { color: colors.success, fontSize: 13, fontWeight: "700" },
  list: { gap: 0 },
  platform: { borderBottomWidth: 1, borderBottomColor: colors.border },
  platformRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 94,
    paddingVertical: 16,
  },
  platformIcon: { width: 44, height: 44, overflow: "visible", flexShrink: 0 },
  platformIdentity: { flex: 1, minWidth: 0, minHeight: 48, justifyContent: "center", gap: 3 },
  identityTitle: { flexDirection: "row", alignItems: "center", gap: 5 },
  accountSummary: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  connectionAction: { width: 106, flexShrink: 0 },
  connectButton: { width: "100%", minHeight: 44, paddingHorizontal: 8 },
  connectedStatus: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    minHeight: 44,
  },
  connected: { color: colors.success, fontSize: 14, fontWeight: "800" },
  accountDetails: { gap: 10, paddingBottom: 16 },
  importSection: { gap: 6, paddingTop: 4 },
  importOption: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 },
  importLabel: { flex: 1, minWidth: 0, color: colors.textSoft, fontSize: 13, lineHeight: 19 },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  account: { gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  accountName: { color: colors.text, fontWeight: "800", flex: 1 },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
});

import { TimezonePicker } from "@/components/pickers";
import { ClientAvatar } from "@/components/client-avatar";
import { useAuth } from "@/auth/context";
import { useCapabilities } from "@/auth/capabilities";
import { StatusBadge } from "@/components/ui";
import { Alert, confirmAction } from "@/components/feedback";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, SectionTitle } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";
import type { Client } from "@/types/domain";

export default function ClientsScreen() {
  const can = useCapabilities();
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("America/Indiana/Indianapolis");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);
  const filtered = clients.filter((row) =>
    `${row.name || ""} ${row.timezone || ""} ${row.status || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  async function load() {
    setError("");
    try {
      setClients(await api.getClients(showArchived));
    } catch (err) {
      setClients([]);
      setError(err instanceof Error ? err.message : "Unable to load clients.");
    }
  }
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [showArchived]),
  );

  async function create() {
    if (!name.trim()) return;
    setWorking(true);
    try {
      await api.createClient(name.trim(), timezone.trim());
      setName("");
      setAdding(false);
      await load();
    } catch (err) {
      Alert.alert("Unable to create client", err instanceof Error ? err.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  async function archive(client: Client) {
    if (
      !(await confirmAction(
        "Archive client?",
        `Archive ${client.name}? Their scheduled and review work will be paused. Restoring the client will not resume publishing automatically.`,
        "Archive client",
      ))
    )
      return;
    setWorking(true);
    try {
      await api.archiveClient(client.id);
      await load();
    } catch (err) {
      Alert.alert("Unable to archive client", err instanceof Error ? err.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  async function remove(client: Client) {
    if (
      !(await confirmAction(
        "Remove client?",
        `Remove ${client.name} from BrandSparQ? Pending work will be canceled and saved social credentials disconnected. This cannot be restored from Archived clients. Audit history is retained; posts already published on social networks are not deleted.`,
        "Remove client",
      ))
    )
      return;
    setWorking(true);
    try {
      await api.removeClient(client.id, client.name);
      await load();
    } catch (err) {
      Alert.alert("Unable to remove client", err instanceof Error ? err.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <PageScroll>
      <PageHeader
        title="Your clients"
        subtitle="Every brand, with its own voice."
        action={
          ["owner", "admin"].includes(user?.role || "") ? (
            <Button
              label="Add client"
              small
              onPress={working ? undefined : () => setAdding(true)}
            />
          ) : undefined
        }
      />

      <Button
        label={showArchived ? "Hide archived clients" : "Show archived clients"}
        secondary
        onPress={() => setShowArchived((v) => !v)}
      />
      {["owner", "admin"].includes(user?.role || "") && (
        <Modal
          visible={adding}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (!working) setAdding(false);
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalOverlay}
          >
            <Pressable
              accessibilityLabel="Close add client"
              style={StyleSheet.absoluteFill}
              disabled={working}
              onPress={() => setAdding(false)}
            />
            <View
              role="dialog"
              accessibilityLabel="Add client"
              accessibilityViewIsModal
              style={styles.modalDialog}
            >
              <ScrollView keyboardShouldPersistTaps="handled">
                <Card>
                  <SectionTitle
                    title="Add client"
                    subtitle="Start with the client name and timezone. Brand Brain can be completed next."
                  />
                  <View style={styles.formRow}>
                    <TextInput
                      accessibilityLabel="Client name"
                      value={name}
                      onChangeText={setName}
                      placeholder="Client name"
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                    />
                    <View style={{ flexGrow: 1, flexBasis: 240 }}>
                      <TimezonePicker value={timezone} onChange={setTimezone} showLabel={false} />
                    </View>
                    <View style={styles.createButton}>
                      <Button
                        label={working ? "Working…" : "Create client"}
                        onPress={working || !name.trim() ? undefined : create}
                      />
                    </View>
                  </View>
                  <Button
                    label="Cancel"
                    secondary
                    onPress={working ? undefined : () => setAdding(false)}
                  />
                </Card>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {error ? (
        <Card subtle>
          <Text style={styles.errorTitle}>Clients unavailable</Text>
          <Text style={styles.sub}>{error}</Text>
          <Pressable onPress={load}>
            <Text style={styles.edit}>Try again</Text>
          </Pressable>
        </Card>
      ) : null}

      <TextInput
        accessibilityLabel="Search client workspaces"
        placeholder="Search client workspaces"
        value={search}
        onChangeText={(value) => {
          setSearch(value);
          setVisibleCount(24);
        }}
        style={{
          minHeight: 48,
          padding: 12,
          color: colors.text,
          backgroundColor: colors.surface,
          borderRadius: 12,
        }}
      />
      <Text style={{ color: colors.muted }}>{filtered.length} matching client workspaces</Text>
      <View style={styles.grid}>
        {filtered.slice(0, visibleCount).map((client) => (
          <Card
            key={client.id}
            style={styles.gridItem}
            role="group"
            accessibilityLabel={`${client.name} client card`}
          >
            <View style={styles.identity}>
              <ClientAvatar client={client} size={44} />
              <Link
                href={{
                  pathname: "/clients/[clientId]",
                  params: { clientId: client.id },
                }}
                asChild
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${client.name} workspace`}
                  style={styles.nameLink}
                >
                  <Text style={styles.cardTitle}>{client.name} →</Text>
                </Pressable>
              </Link>
              <StatusBadge label={client.status || "active"} />
            </View>
            <Text
              accessibilityLabel={`${client.name} brand voice`}
              numberOfLines={3}
              style={styles.voice}
            >
              {client.brandVoice?.trim() ||
                "Add a brand voice in Brand Brain to guide this client’s content."}
            </Text>
            <View style={styles.actions}>
              <Link href={`/clients/${client.id}/brand`} asChild>
                <Pressable>
                  <Text style={styles.edit}>Edit Brand Brain →</Text>
                </Pressable>
              </Link>
              {can("client_manage", client.id) &&
                (client.status === "archived" ? (
                  <Button
                    label="Restore client"
                    small
                    onPress={
                      working
                        ? undefined
                        : async () => {
                            setWorking(true);
                            try {
                              await api.restoreClient(client.id);
                              await load();
                            } catch (e) {
                              Alert.alert(
                                "Unable to restore",
                                e instanceof Error ? e.message : "Try again.",
                              );
                            } finally {
                              setWorking(false);
                            }
                          }
                    }
                  />
                ) : (
                  <Pressable disabled={working} onPress={() => archive(client)}>
                    <Text style={styles.archive}>Archive</Text>
                  </Pressable>
                ))}
              {can("client_manage", client.id) && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${client.name}`}
                  disabled={working}
                  onPress={() => remove(client)}
                  style={styles.removeAction}
                >
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              )}
            </View>
          </Card>
        ))}
      </View>

      {!error && !clients.length && (
        <Card subtle>
          <Text style={styles.errorTitle}>No clients yet</Text>
          <Text style={styles.sub}>Create your first client above.</Text>
        </Card>
      )}
      {filtered.length > visibleCount && (
        <Button
          label="Show more client workspaces"
          secondary
          onPress={() => setVisibleCount((count) => count + 24)}
        />
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(7,26,93,0.45)",
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  modalDialog: { width: "100%", maxWidth: 720, maxHeight: "90%" },
  removeAction: {
    minHeight: 44,
    alignSelf: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  removeText: { color: colors.danger, fontSize: 13, fontWeight: "700" },
  formRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  input: {
    flexGrow: 1,
    flexBasis: 240,
    minWidth: 0,
    minHeight: 48,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  createButton: { minWidth: 150 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  gridItem: { flexGrow: 1, flexBasis: 300, maxWidth: "100%", minHeight: 210 },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  nameLink: { flex: 1, minWidth: 0, minHeight: 48, justifyContent: "center" },
  voice: { color: colors.muted, fontSize: 15, lineHeight: 22, minHeight: 66 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  actions: {
    marginTop: "auto",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  edit: { minHeight: 44, textAlignVertical: "center", color: colors.primary, fontWeight: "800" },
  archive: { minHeight: 44, textAlignVertical: "center", color: colors.warning, fontWeight: "800" },
  errorTitle: { color: colors.text, fontSize: 20, fontWeight: "900" },
});

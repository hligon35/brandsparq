import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, SectionTitle } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";
import type { Client } from "@/types/domain";

export default function ClientsScreen() {
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("America/Indiana/Indianapolis");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      setClients(await api.getClients());
    } catch (err) {
      setClients([]);
      setError(err instanceof Error ? err.message : "Unable to load clients.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!name.trim()) return;
    setWorking(true);
    try {
      await api.createClient(name.trim(), timezone.trim());
      setName("");
      await load();
    } catch (err) {
      Alert.alert("Unable to create client", err instanceof Error ? err.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  async function archive(client: Client) {
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

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Brand intelligence"
        title="Clients & Brand Brain"
        subtitle="Create clients and manage the rules BrandSparQ uses to create, caption, and schedule their content."
      />

      <Card>
        <SectionTitle
          title="Add client"
          subtitle="Start with the client name and timezone. Brand Brain can be completed next."
        />
        <View style={styles.formRow}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Client name"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <TextInput
            value={timezone}
            onChangeText={setTimezone}
            placeholder="America/Indiana/Indianapolis"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <View style={styles.createButton}>
            <Button
              label={working ? "Working…" : "Create client"}
              onPress={working || !name.trim() ? undefined : create}
            />
          </View>
        </View>
      </Card>

      {error ? (
        <Card subtle>
          <Text style={styles.errorTitle}>Clients unavailable</Text>
          <Text style={styles.sub}>{error}</Text>
          <Pressable onPress={load}>
            <Text style={styles.edit}>Try again</Text>
          </Pressable>
        </Card>
      ) : null}

      <View style={styles.grid}>
        {clients.map((client) => (
          <Card key={client.id} style={styles.gridItem}>
            <View
              style={[styles.clientColor, { backgroundColor: client.color || colors.primary }]}
            />
            <Text style={styles.cardTitle}>{client.name}</Text>
            <Text style={styles.sub}>{client.timezone || "Timezone not set"}</Text>
            <Text style={styles.sub}>
              Voice, audience, CTA, imagery, colors, assets, and posting rules
            </Text>
            <View style={styles.actions}>
              <Link href={`/clients/${client.id}/brand`} asChild>
                <Pressable>
                  <Text style={styles.edit}>Edit Brand Brain →</Text>
                </Pressable>
              </Link>
              <Pressable disabled={working} onPress={() => archive(client)}>
                <Text style={styles.archive}>Archive</Text>
              </Pressable>
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
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  formRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  input: {
    flexGrow: 1,
    flexBasis: 240,
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
  gridItem: { flexGrow: 1, flexBasis: 300, maxWidth: "100%", minHeight: 220 },
  clientColor: { width: 46, height: 8, borderRadius: 999 },
  cardTitle: { color: colors.text, fontSize: 20, fontWeight: "900" },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  actions: {
    marginTop: "auto",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  edit: { color: colors.primary, fontWeight: "800" },
  archive: { color: colors.warning, fontWeight: "800" },
  errorTitle: { color: colors.text, fontSize: 20, fontWeight: "900" },
});

import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Card, PageHeader, PageScroll } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";
import type { Client } from "@/types/domain";

export default function ClientsScreen() {
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    api.getClients().then(setClients).catch(() => {});
  }, []);

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Brand intelligence"
        title="Clients & Brand Brain"
        subtitle="Manage the rules BrandSparQ uses to create, caption, and schedule content for each client."
      />

      <View style={styles.grid}>
        {clients.map((client) => (
          <Link
            key={client.id}
            href={`/clients/${client.id}/brand`}
            asChild
          >
            <Pressable style={styles.gridItem}>
              <Card style={styles.card}>
                <View
                  style={[
                    styles.clientColor,
                    { backgroundColor: client.color || colors.primary },
                  ]}
                />
                <Text style={styles.cardTitle}>{client.name}</Text>
                <Text style={styles.sub}>
                  Voice, audience, CTA, imagery, colors, and posting rules
                </Text>
                <Text style={styles.edit}>Edit Brand Brain →</Text>
              </Card>
            </Pressable>
          </Link>
        ))}
      </View>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  gridItem: {
    flexGrow: 1,
    flexBasis: 300,
    maxWidth: "100%",
  },
  card: {
    minHeight: 210,
  },
  clientColor: {
    width: 46,
    height: 8,
    borderRadius: 999,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  sub: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  edit: {
    marginTop: "auto",
    color: colors.primary,
    fontWeight: "800",
  },
});

import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Card, Screen } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";
import type { Client } from "@/types/domain";

export default function ClientsScreen() {
  const [clients, setClients] = useState<Client[]>([]);
  useEffect(() => { api.getClients().then(setClients).catch(() => {}); }, []);
  return (
    <Screen>
      <Text style={styles.title}>Clients & Brand Brain</Text>
      <Text style={styles.sub}>Manage the rules BrandSparQ uses to create and schedule content.</Text>
      <View style={styles.list}>
        {clients.map((client) => (
          <Link key={client.id} href={`/clients/${client.id}/brand`} asChild>
            <Pressable><Card><Text style={styles.card}>{client.name}</Text><Text style={styles.sub}>Voice, audience, CTA, imagery and posting rules</Text></Card></Pressable>
          </Link>
        ))}
      </View>
    </Screen>
  );
}
const styles=StyleSheet.create({
  title:{color:colors.text,fontSize:28,fontWeight:"800"},
  sub:{color:colors.muted,fontSize:15,lineHeight:22},
  list:{gap:spacing.md},
  card:{color:colors.text,fontSize:18,fontWeight:"700"}
});

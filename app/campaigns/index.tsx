import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

export default function CampaignsScreen() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const result = await api.getCampaigns();
      setCampaigns(result.data);
    } catch (err) {
      setCampaigns([]);
      setError(err instanceof Error ? err.message : "Unable to load campaigns.");
    }
  }

  useEffect(() => { void load(); }, []);
  return (
    <PageScroll>
      <PageHeader eyebrow="Campaign management" title="Campaigns" subtitle="Track generated campaigns, review progress, and see what has been published." />
      {error && (
        <Card subtle>
          <Text style={styles.title}>Campaigns unavailable</Text>
          <Text style={styles.meta}>{error}</Text>
          <Pressable onPress={load}><Text style={styles.retry}>Try again</Text></Pressable>
        </Card>
      )}
      <View style={styles.grid}>
        {campaigns.map((campaign) => (
          <Link key={campaign.id} href={`/campaigns/${campaign.id}`} asChild>
            <Pressable style={styles.item}>
              <Card style={styles.card}>
                <View style={styles.row}>
                  <StatusBadge label={campaign.status || "draft"} />
                  <Text style={styles.client}>{campaign.client_name || campaign.client_id}</Text>
                </View>
                <Text style={styles.title}>{campaign.name}</Text>
                <Text style={styles.meta}>{campaign.objective || "General campaign"}</Text>
                <View style={styles.stats}>
                  <Text style={styles.stat}>{campaign.post_count || 0} posts</Text>
                  <Text style={styles.stat}>{campaign.review_count || 0} review</Text>
                  <Text style={styles.stat}>{campaign.published_count || 0} published</Text>
                </View>
              </Card>
            </Pressable>
          </Link>
        ))}
        {!campaigns.length && <Card subtle><Text style={styles.meta}>No campaigns yet.</Text></Card>}
      </View>
    </PageScroll>
  );
}
const styles = StyleSheet.create({
  grid:{flexDirection:"row",flexWrap:"wrap",gap:spacing.md},
  item:{flexGrow:1,flexBasis:300,maxWidth:"100%"},
  card:{minHeight:190},
  row:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:spacing.sm},
  client:{color:colors.muted,fontSize:12,fontWeight:"800"},
  title:{color:colors.text,fontSize:20,fontWeight:"900"},
  meta:{color:colors.muted,lineHeight:21},
  stats:{marginTop:"auto",flexDirection:"row",flexWrap:"wrap",gap:12},
  stat:{color:colors.primary,fontWeight:"800",fontSize:12},
  retry:{color:colors.primary,fontWeight:"800"}
});

import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, spacing } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

export default function ReviewScreen() {
  const [posts, setPosts] = useState<MarketingPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { compact } = useResponsive();

  async function load() {
    setLoading(true); setError("");
    try { setPosts(await api.getReviewQueue()); }
    catch (err) { setPosts([]); setError(err instanceof Error ? err.message : "Unable to load review queue."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Approval inbox"
        title="Review"
        subtitle="Generated content stays out of the marketing calendar until you approve it."
        action={<Pressable onPress={load}><Text style={styles.refresh}>Refresh</Text></Pressable>}
      />

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <Card subtle>
          <Text style={styles.emptyTitle}>Review queue unavailable</Text>
          <Text style={styles.emptyBody}>{error}</Text>
          <Pressable onPress={load}><Text style={styles.refresh}>Try again</Text></Pressable>
        </Card>
      ) : posts.length ? (
        <View style={styles.grid}>
          {posts.map((post) => (
            <View key={post.id} style={[styles.gridItem, compact && styles.gridItemCompact]}>
              <Link href={`/posts/${post.id}`} asChild>
                <Pressable style={styles.pressableCard}>
                  <Card style={styles.card}>
                    <View style={styles.cardTop}>
                      <StatusBadge label={post.status} />
                      {!!post.sparqScore && <Text style={styles.score}>{post.sparqScore}</Text>}
                    </View>
                    <Text style={styles.client}>{post.clientName || "Client"}</Text>
                    <Text style={styles.platform}>{post.platform.toUpperCase()}</Text>
                    <Text style={styles.cardTitle}>{post.title}</Text>
                    {!!post.suggestedPublishAt && (
                      <Text style={styles.time}>Suggested · {new Date(post.suggestedPublishAt).toLocaleString()}</Text>
                    )}
                  </Card>
                </Pressable>
              </Link>
            </View>
          ))}
        </View>
      ) : (
        <Card subtle>
          <Text style={styles.emptyTitle}>You’re caught up.</Text>
          <Text style={styles.emptyBody}>Nothing is waiting for approval right now.</Text>
        </Card>
      )}
    </PageScroll>
  );
}

const styles=StyleSheet.create({
  refresh:{color:colors.primary,fontWeight:"800",paddingVertical:8},loading:{paddingVertical:60},
  grid:{flexDirection:"row",flexWrap:"wrap",gap:spacing.md,alignItems:"stretch"},gridItem:{flexGrow:1,flexBasis:310,maxWidth:"100%"},
  gridItemCompact:{flexBasis:"100%"},pressableCard:{flex:1},card:{height:"100%",minHeight:220},
  cardTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:spacing.sm},
  score:{color:colors.orange,fontSize:22,fontWeight:"900"},client:{color:colors.text,fontSize:18,fontWeight:"900"},
  platform:{color:colors.primary,fontSize:11,fontWeight:"900",letterSpacing:1.1},cardTitle:{color:colors.textSoft,fontSize:16,lineHeight:23,fontWeight:"700"},
  time:{color:colors.muted,fontSize:13,lineHeight:19,marginTop:"auto"},emptyTitle:{color:colors.text,fontSize:20,fontWeight:"900"},emptyBody:{color:colors.muted},
});

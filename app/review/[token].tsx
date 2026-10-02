import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Image, StyleSheet, Text } from "react-native";
import { api } from "@/api/client";
import { Button, Card, Screen, StatusBadge } from "@/components/ui";
import { colors, radius } from "@/theme/tokens";

export default function PublicReviewScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [post, setPost] = useState<any>();
  const [working, setWorking] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (token) {
      api.getPublicReview(token).then((r) => setPost(r.data)).catch((e) => {
        Alert.alert("Review link unavailable", e instanceof Error ? e.message : "This review link is invalid.");
      });
    }
  }, [token]);

  async function approve() {
    if (!token) return;
    setWorking(true);
    try {
      await api.approvePublicReview(token);
      setApproved(true);
    } catch (error) {
      Alert.alert("Approval failed", error instanceof Error ? error.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.eyebrow}>BRANDSPARQ REVIEW</Text>
      {approved ? (
        <Card>
          <Text style={styles.title}>Approved</Text>
          <Text style={styles.sub}>This post has been added to the official marketing calendar.</Text>
        </Card>
      ) : post ? (
        <>
          <StatusBadge label={post.status} />
          <Text style={styles.title}>{post.client_name}</Text>
          <Text style={styles.platform}>{String(post.platform).toUpperCase()}</Text>
          <Card>
            {post.image_url ? (
              <Image source={{ uri: post.image_url }} style={styles.image} />
            ) : (
              <Text style={styles.preview}>GRAPHIC GENERATION PENDING</Text>
            )}
          </Card>
          <Text style={styles.heading}>{post.headline || post.title}</Text>
          <Text style={styles.sub}>{post.caption}</Text>
          <Card>
            <Text style={styles.label}>Suggested publish time</Text>
            <Text style={styles.heading}>{post.suggested_publish_at ? new Date(post.suggested_publish_at).toLocaleString() : "Not selected"}</Text>
          </Card>
          <Button label={working ? "Approving…" : "Approve and add to calendar"} onPress={working ? undefined : approve} />
        </>
      ) : (
        <Text style={styles.sub}>Loading review…</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow:{color:colors.accent,fontWeight:"800",letterSpacing:2},
  title:{color:colors.text,fontSize:28,fontWeight:"800"},
  platform:{color:colors.accent,fontWeight:"800"},
  heading:{color:colors.text,fontSize:18,fontWeight:"700"},
  sub:{color:colors.muted,fontSize:16,lineHeight:24},
  label:{color:colors.muted,fontSize:12,fontWeight:"800",textTransform:"uppercase"},
  image:{width:"100%",aspectRatio:4/5,borderRadius:radius.md,backgroundColor:colors.surface},
  preview:{color:colors.muted,textAlign:"center",paddingVertical:72,fontWeight:"700"}
});

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { api } from "@/api/client";
import { Button, Card, Screen, StatusBadge } from "@/components/ui";
import { clients, posts as demoPosts } from "@/data/demo";
import { colors, radius, spacing } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

type AiAction = "rewrite" | "image" | "regenerate" | null;

export default function PostReviewScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const [post, setPost] = useState<MarketingPost | undefined>(demoPosts.find((item) => item.id === postId));
  const [saving, setSaving] = useState(false);
  const [aiAction, setAiAction] = useState<AiAction>(null);
  const [instruction, setInstruction] = useState("");

  async function reload() {
    if (!postId) return;
    setPost(await api.getPost(postId));
  }

  useEffect(() => {
    if (!postId) return;
    api.getPost(postId).then(setPost).catch(() => {});
  }, [postId]);

  if (!post) return <Screen><Text style={styles.title}>Post not found</Text></Screen>;
  const demoClient = clients.find((item) => item.id === post.clientId);

  async function approve() {
    setSaving(true);
    try {
      await api.approvePost(post.id);
      Alert.alert("Approved", "This post is now on the marketing calendar.");
      router.back();
    } catch (error) {
      Alert.alert("Approval failed", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function runAi(action: Exclude<AiAction, null>) {
    if (action === "image" && !instruction.trim()) {
      Alert.alert("Describe the edit", "Enter what you want changed in the graphic first.");
      return;
    }
    setAiAction(action);
    try {
      if (action === "rewrite") await api.rewritePostCaption(post.id, instruction.trim() || undefined);
      else if (action === "image") await api.editPostGraphic(post.id, instruction.trim());
      else await api.regeneratePost(post.id, instruction.trim() || undefined);
      await reload();
      setInstruction("");
    } catch (error) {
      Alert.alert("AI update failed", error instanceof Error ? error.message : "Unable to update this post.");
    } finally {
      setAiAction(null);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <StatusBadge label={post.status} />
        <Text style={styles.title}>{post.clientName || demoClient?.name || "Client"}</Text>
        <Text style={styles.platform}>{post.platform.toUpperCase()}</Text>
        <Card>
          {post.imageUrl ? <Image source={{ uri: post.imageUrl }} style={styles.image} /> : <Text style={styles.placeholder}>GRAPHIC GENERATION PENDING</Text>}
        </Card>
        <Text style={styles.heading}>{post.title}</Text>
        <Text style={styles.body}>{post.caption}</Text>
        <Card>
          <Text style={styles.label}>Recommended slot</Text>
          <Text style={styles.heading}>{post.suggestedPublishAt ? new Date(post.suggestedPublishAt).toLocaleString() : "Not selected"}</Text>
        </Card>
        <Card>
          <Text style={styles.label}>AI change request</Text>
          <Text style={styles.helper}>Optional for caption rewrite/regeneration. Required for a precise graphic edit.</Text>
          <TextInput
            value={instruction}
            onChangeText={setInstruction}
            multiline
            placeholder="Example: Keep the product untouched, make the background more energetic, and reduce the headline."
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Button label={aiAction === "rewrite" ? "Rewriting…" : "Rewrite caption"} onPress={aiAction ? undefined : () => runAi("rewrite")} secondary />
          <Button label={aiAction === "image" ? "Editing graphic…" : "Edit graphic with AI"} onPress={aiAction ? undefined : () => runAi("image")} secondary />
          <Button label={aiAction === "regenerate" ? "Regenerating…" : "Regenerate post"} onPress={aiAction ? undefined : () => runAi("regenerate")} secondary />
        </Card>
        <Button label={saving ? "Approving…" : "Approve post"} onPress={saving || aiAction ? undefined : approve} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content:{gap:spacing.md,paddingBottom:40},
  title:{color:colors.text,fontSize:28,fontWeight:"800"},
  platform:{color:colors.accent,fontWeight:"800"},
  image:{width:"100%",aspectRatio:4/5,borderRadius:radius.md,backgroundColor:colors.surface2},
  placeholder:{color:colors.muted,textAlign:"center",paddingVertical:72,fontWeight:"700"},
  heading:{color:colors.text,fontSize:18,fontWeight:"700"},
  body:{color:colors.muted,fontSize:16,lineHeight:24},
  label:{color:colors.muted,fontSize:12,textTransform:"uppercase",fontWeight:"700"},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  input:{minHeight:110,color:colors.text,backgroundColor:colors.surface2,borderRadius:radius.md,padding:spacing.md,textAlignVertical:"top"}
});

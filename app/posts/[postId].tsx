import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
} from "react-native";
import { api } from "@/api/client";
import {
  Button,
  Card,
  PageHeader,
  PageScroll,
  SectionTitle,
  StatusBadge,
} from "@/components/ui";
import { clients, posts as demoPosts } from "@/data/demo";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

type AiAction = "rewrite" | "image" | "regenerate" | null;

export default function PostReviewScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const [post, setPost] = useState<MarketingPost | undefined>(
    demoPosts.find((item) => item.id === postId)
  );
  const [saving, setSaving] = useState(false);
  const [aiAction, setAiAction] = useState<AiAction>(null);
  const [instruction, setInstruction] = useState("");
  const [socialAccounts, setSocialAccounts] = useState<any[]>([]);
  const [assigningAccount, setAssigningAccount] = useState(false);
  const { wide } = useResponsive();

  async function reload() {
    if (!postId) return;
    setPost(await api.getPost(postId));
  }

  useEffect(() => {
    if (!postId) return;
    api.getPost(postId).then(setPost).catch(() => {});
  }, [postId]);

  useEffect(() => {
    if (!post?.clientId) return;
    api.getSocialAccounts(post.clientId)
      .then(({ data }) =>
        setSocialAccounts(
          data.filter((account: any) =>
            account.platform === post.platform && account.status === "connected"
          )
        )
      )
      .catch(() => setSocialAccounts([]));
  }, [post?.clientId, post?.platform]);

  if (!post) {
    return (
      <PageScroll>
        <Text style={styles.title}>Post not found</Text>
      </PageScroll>
    );
  }

  const demoClient = clients.find(
    (item) => item.id === post.clientId
  );

  async function assignAccount(accountId: string) {
    setAssigningAccount(true);
    try {
      await api.assignSocialAccount(post!.id, accountId);
      await reload();
    } catch (error) {
      Alert.alert(
        "Unable to assign account",
        error instanceof Error ? error.message : "Try again."
      );
    } finally {
      setAssigningAccount(false);
    }
  }

  async function approve() {
    setSaving(true);
    try {
      await api.approvePost(post!.id);
      Alert.alert(
        "Approved",
        "This post is now on the marketing calendar."
      );
      router.back();
    } catch (error) {
      Alert.alert(
        "Approval failed",
        error instanceof Error ? error.message : "Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  async function runAi(action: Exclude<AiAction, null>) {
    if (action === "image" && !instruction.trim()) {
      Alert.alert(
        "Describe the edit",
        "Enter what you want changed in the graphic first."
      );
      return;
    }

    setAiAction(action);
    try {
      if (action === "rewrite") {
        await api.rewritePostCaption(
          post!.id,
          instruction.trim() || undefined
        );
      } else if (action === "image") {
        await api.editPostGraphic(post!.id, instruction.trim());
      } else {
        await api.regeneratePost(
          post!.id,
          instruction.trim() || undefined
        );
      }
      await reload();
      setInstruction("");
    } catch (error) {
      Alert.alert(
        "AI update failed",
        error instanceof Error
          ? error.message
          : "Unable to update this post."
      );
    } finally {
      setAiAction(null);
    }
  }

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Review content"
        title={post.clientName || demoClient?.name || "Client"}
        subtitle={post.platform.toUpperCase()}
        action={<StatusBadge label={post.status} />}
      />

      <View style={[styles.reviewGrid, wide && styles.reviewGridWide]}>
        <Card style={styles.mediaCard}>
          {post.imageUrl ? (
            <Image
              source={{ uri: post.imageUrl }}
              style={styles.image}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.placeholderWrap}>
              <Text style={styles.placeholder}>
                GRAPHIC GENERATION PENDING
              </Text>
            </View>
          )}
        </Card>

        <View style={styles.copyColumn}>
          <Card>
            <SectionTitle
              title={post.title}
              subtitle="Caption"
            />
            <Text style={styles.body}>{post.caption}</Text>
          </Card>

          <Card>
            <SectionTitle
              title="Publishing account"
              subtitle={post.socialAccountName ? "This post is ready to publish to the selected account." : "Choose the connected account that should receive this post."}
            />
            {socialAccounts.length ? (
              <View style={styles.accountList}>
                {socialAccounts.map((account: any) => {
                  const active = account.id === post.socialAccountId;
                  return (
                    <Pressable
                      key={account.id}
                      disabled={assigningAccount}
                      onPress={() => assignAccount(account.id)}
                      style={[styles.accountOption, active && styles.accountOptionActive]}
                    >
                      <Text style={[styles.accountName, active && styles.accountNameActive]}>
                        {account.account_name}
                      </Text>
                      <Text style={[styles.accountPlatform, active && styles.accountNameActive]}>
                        {String(account.platform).toUpperCase()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.accountWarning}>
                No connected {post.platform} account is available for this client. Connect one from More → Social connections before publishing.
              </Text>
            )}
          </Card>

          <Card subtle>
            <Text style={styles.label}>Recommended slot</Text>
            <Text style={styles.heading}>
              {post.suggestedPublishAt
                ? new Date(post.suggestedPublishAt).toLocaleString()
                : "Not selected"}
            </Text>
          </Card>

          <Button
            label={saving ? "Approving…" : "Approve post"}
            onPress={saving || aiAction || !post.socialAccountId ? undefined : approve}
          />
        </View>
      </View>

      <Card>
        <SectionTitle
          title="AI change request"
          subtitle="Rewrite the caption, edit the graphic, or regenerate the whole post."
        />
        <TextInput
          value={instruction}
          onChangeText={setInstruction}
          multiline
          placeholder="Example: Keep the product untouched, make the background more energetic, and reduce the headline."
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <View style={styles.aiActions}>
          <View style={styles.aiButton}>
            <Button
              label={
                aiAction === "rewrite"
                  ? "Rewriting…"
                  : "Rewrite caption"
              }
              onPress={
                aiAction ? undefined : () => runAi("rewrite")
              }
              secondary
            />
          </View>
          <View style={styles.aiButton}>
            <Button
              label={
                aiAction === "image"
                  ? "Editing graphic…"
                  : "Edit graphic with AI"
              }
              onPress={
                aiAction ? undefined : () => runAi("image")
              }
              secondary
            />
          </View>
          <View style={styles.aiButton}>
            <Button
              label={
                aiAction === "regenerate"
                  ? "Regenerating…"
                  : "Regenerate post"
              }
              onPress={
                aiAction ? undefined : () => runAi("regenerate")
              }
              secondary
            />
          </View>
        </View>
      </Card>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900",
  },
  reviewGrid: {
    gap: spacing.md,
  },
  reviewGridWide: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  mediaCard: {
    flex: 1.05,
    padding: 10,
  },
  copyColumn: {
    flex: 0.95,
    gap: spacing.md,
    minWidth: 0,
  },
  image: {
    width: "100%",
    aspectRatio: 4 / 5,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  placeholderWrap: {
    aspectRatio: 4 / 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
  },
  placeholder: {
    color: colors.muted,
    textAlign: "center",
    fontWeight: "800",
  },
  heading: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  body: {
    color: colors.textSoft,
    fontSize: 16,
    lineHeight: 25,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  input: {
    minHeight: 120,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    textAlignVertical: "top",
    fontSize: 15,
  },
  accountList: {
    gap: spacing.sm,
  },
  accountOption: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  accountOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  accountName: {
    color: colors.text,
    fontWeight: "800",
  },
  accountPlatform: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
  },
  accountNameActive: {
    color: colors.white,
  },
  accountWarning: {
    color: colors.warning,
    lineHeight: 20,
    fontWeight: "700",
  },
  aiActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  aiButton: {
    flexGrow: 1,
    flexBasis: 190,
  },
});

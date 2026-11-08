import { reviewCopyEditable, scheduledCopyEditable } from "@/shared/post-copy";
import { EssentialSection } from "@/components/essential";
import { renderFinalCopy, finalCopyError } from "@/shared/final-copy";
import { EditConflict, isEditConflict } from "@/components/edit-conflict";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useCapabilities } from "@/auth/capabilities";
import { Alert, confirmAction } from "@/components/feedback";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, TextInput, Pressable, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

type AiAction = "rewrite" | "image" | "regenerate" | null;

export default function PostReviewScreen() {
  const can = useCapabilities();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const [conflict, setConflict] = useState(false);
  const entityRef = useRef(postId);
  entityRef.current = postId;
  const loadVersion = useRef(0);
  const [post, setPost] = useState<MarketingPost | undefined>();
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const previewAttempt = useRef("");
  const [previewError, setPreviewError] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  async function renewPreview() {
    if (previewBusy) return;
    const id = postId;
    setPreviewBusy(true);
    try {
      const fresh = await api.getPost(id);
      if (entityRef.current !== id) return;
      // Only renew media; never replace draft copy, approval state or edit revisions.
      setPost((current) =>
        current?.id === id
          ? { ...current, imageUrl: fresh.imageUrl, sourceImageUrl: fresh.sourceImageUrl }
          : current,
      );
      setPreviewError(!fresh.imageUrl && !fresh.sourceImageUrl);
    } catch {
      if (entityRef.current === id) setPreviewError(true);
    } finally {
      if (entityRef.current === id) setPreviewBusy(false);
    }
  }
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiAction, setAiAction] = useState<AiAction>(null);
  const [instruction, setInstruction] = useState("");
  const [headlineDraft, setHeadlineDraft] = useState("");
  const [captionDraft, setCaptionDraft] = useState("");
  const [socialAccounts, setSocialAccounts] = useState<any[]>([]);
  const [creative, setCreative] = useState<any>(null);
  const [assigningAccount, setAssigningAccount] = useState(false);
  const { wide } = useResponsive();
  const { dirty, markSaved } = useUnsavedChanges(
    { headlineDraft, captionDraft },
    !!post &&
      can("review", post.clientId) &&
      (reviewCopyEditable(post.status) ||
        (scheduledCopyEditable(post.status) && can("calendar_manage", post.clientId))),
    (saved) => {
      setHeadlineDraft(saved.headlineDraft);
      setCaptionDraft(saved.captionDraft);
    },
  );

  async function reload() {
    const version = ++loadVersion.current;
    setConflict(false);
    if (!postId) return;
    setLoadError("");
    try {
      const [nextPost, nextCreative, clients] = await Promise.all([
        api.getPost(postId),
        api.getPostCreative(postId).catch(() => ({ data: null })),
        api.getClients(),
      ]);
      if (version !== loadVersion.current || entityRef.current !== postId) return;
      setTimezone(
        clients.find((client) => client.id === nextPost.clientId)?.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      previewAttempt.current = "";
      setPreviewError(false);
      setPost(nextPost);
      setHeadlineDraft(nextPost.title || "");
      setCaptionDraft(renderFinalCopy(nextPost.caption || "", nextPost.hashtags));
      markSaved({
        headlineDraft: nextPost.title || "",
        captionDraft: renderFinalCopy(nextPost.caption || "", nextPost.hashtags),
      });
      setCreative(nextCreative.data);
    } catch (error) {
      if (version !== loadVersion.current || entityRef.current !== postId) return;
      if (isEditConflict(error)) setConflict(true);
      setPost(undefined);
      setLoadError(error instanceof Error ? error.message : "Unable to load post.");
      throw error;
    }
  }

  useEffect(() => {
    void reload().catch(() => undefined);
    return () => {
      loadVersion.current++;
    };
  }, [postId]);

  useEffect(() => {
    if (!post?.clientId) return;
    api
      .getSocialAccounts(post.clientId)
      .then(({ data }) =>
        setSocialAccounts(
          data.filter(
            (account: any) => account.platform === post.platform && account.status === "connected",
          ),
        ),
      )
      .catch(() => setSocialAccounts([]));
  }, [post?.clientId, post?.platform]);

  useEffect(() => {
    if (!["regenerating", "review_ready"].includes(post?.status || "")) return;
    const timer = setInterval(() => {
      if (!dirty) void reload().catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [post?.status, postId, dirty]);

  if (!post) {
    return (
      <PageScroll>
        <Card subtle>
          <Text style={styles.title}>{loadError ? "Post unavailable" : "Loading post…"}</Text>
          {!!loadError && <Text style={styles.body}>{loadError}</Text>}
          {!!loadError && (
            <Pressable onPress={() => void reload()}>
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          )}
        </Card>
      </PageScroll>
    );
  }

  const reviewable = reviewCopyEditable(post.status);
  const editable = reviewable && can("review", post.clientId);
  const scheduled = scheduledCopyEditable(post.status);
  const copyEditable =
    can("review", post.clientId) &&
    (reviewable || (scheduled && can("calendar_manage", post.clientId)));
  const previewUrl = post.imageUrl || post.sourceImageUrl;
  async function assignAccount(accountId: string) {
    if (
      dirty &&
      !(await confirmAction(
        "Replace unsaved copy?",
        "This action reloads the post and replaces your unsaved copy. Save your copy first to keep it.",
        "Replace copy",
        "Keep editing",
      ))
    )
      return;
    setAssigningAccount(true);
    try {
      await api.assignSocialAccount(post!.id, accountId, post!.revision);
      await reload();
    } catch (error) {
      if (isEditConflict(error)) setConflict(true);
      Alert.alert(
        "Unable to assign account",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setAssigningAccount(false);
    }
  }

  async function saveCopy() {
    setSaving(true);
    try {
      await api.editPost(post!.id, {
        headline: headlineDraft,
        caption: captionDraft,
        hashtags: [],
        expectedRevision: post!.revision,
      });
      await reload();
    } catch (error) {
      if (isEditConflict(error)) setConflict(true);
      Alert.alert("Unable to save edits", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function reject() {
    if (
      dirty &&
      !(await confirmAction(
        "Replace unsaved copy?",
        "This action reloads the post and replaces your unsaved copy. Save your copy first to keep it.",
        "Replace copy",
        "Keep editing",
      ))
    )
      return;
    setSaving(true);
    try {
      await api.rejectPost(post!.id, instruction.trim() || "Changes requested.");
      await reload();
    } catch (error) {
      if (isEditConflict(error)) setConflict(true);
      Alert.alert(
        "Unable to request changes",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    setSaving(true);
    try {
      let revision = post!.revision;
      {
        const saved = await api.editPost(post!.id, {
          headline: headlineDraft,
          caption: captionDraft,
          hashtags: [],
          expectedRevision: revision,
        });
        revision = saved.revision;
        markSaved({ headlineDraft, captionDraft });
      }
      await api.approvePost(post!.id, revision);
      Alert.alert("Approved", "This post is now on the marketing calendar.");
      router.back();
    } catch (error) {
      if (isEditConflict(error)) setConflict(true);
      Alert.alert("Approval failed", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function runAi(action: Exclude<AiAction, null>) {
    if (
      dirty &&
      !(await confirmAction(
        "Replace unsaved copy?",
        "This action reloads the post and replaces your unsaved copy. Save your copy first to keep it.",
        "Replace copy",
        "Keep editing",
      ))
    )
      return;
    if (action === "image" && !instruction.trim()) {
      Alert.alert("Describe the edit", "Enter what you want changed in the graphic first.");
      return;
    }

    setAiAction(action);
    try {
      if (action === "rewrite") {
        await api.rewritePostCaption(post!.id, instruction.trim() || undefined);
      } else if (action === "image") {
        await api.editPostGraphic(post!.id, instruction.trim());
      } else {
        await api.regeneratePost(post!.id, instruction.trim() || undefined);
      }
      await reload();
      setInstruction("");
    } catch (error) {
      if (isEditConflict(error)) setConflict(true);
      Alert.alert(
        "AI update failed",
        error instanceof Error ? error.message : "Unable to update this post.",
      );
    } finally {
      setAiAction(null);
    }
  }

  return (
    <PageScroll>
      {conflict && <EditConflict busy={saving || assigningAccount} onReload={reload} />}
      <PageHeader
        title={post.clientName || "Client"}
        subtitle={post.platform.toUpperCase()}
        action={<StatusBadge label={post.status} />}
      />

      <View style={[styles.reviewGrid, wide && styles.reviewGridWide]}>
        <Card style={[styles.mediaCard, wide ? { flex: 1.05 } : { width: "100%" }]}>
          {previewUrl ? (
            <Image
              accessibilityLabel={post.imageUrl ? "Post image" : "Source photo preview"}
              source={{ uri: previewUrl }}
              resizeMethod="resize"
              style={styles.image}
              resizeMode="contain"
              onError={() => {
                setPreviewError(true);
                if (previewAttempt.current !== postId) {
                  previewAttempt.current = postId;
                  void renewPreview();
                }
              }}
              onLoad={() => setPreviewError(false)}
            />
          ) : (
            <View style={styles.placeholderWrap}>
              <Text style={styles.placeholder}>Image not available yet</Text>
            </View>
          )}
          {!post.imageUrl && post.sourceImageUrl && (
            <Text style={styles.body}>
              Source photo shown. The generated graphic is unavailable and must be completed before
              publishing.
            </Text>
          )}
          {previewError && (
            <View>
              <Text style={styles.body}>Image preview unavailable. Your edits are preserved.</Text>
              <Button
                label={previewBusy ? "Loading preview…" : "Retry image preview"}
                secondary
                onPress={previewBusy ? undefined : renewPreview}
              />
            </View>
          )}
        </Card>

        <View style={[styles.copyColumn, wide ? { flex: 0.95 } : { width: "100%" }]}>
          {post.artworkReady === false && (
            <Card subtle>
              <Text accessibilityRole="alert">
                Final artwork is missing. Complete the graphic before approval or publishing. Your
                caption and chosen time are preserved.
              </Text>
            </Card>
          )}
          <EssentialSection
            title="Final publication copy"
            summary={
              scheduled
                ? "Save caption changes here without changing the scheduled date or time."
                : "Review the image, caption, and hashtags before approval."
            }
            collapsible={false}
          >
            <Text style={styles.label}>Headline</Text>
            <TextInput
              accessibilityLabel="Headline"
              editable={copyEditable && !saving && !assigningAccount && !aiAction}
              value={headlineDraft}
              onChangeText={setHeadlineDraft}
              style={styles.singleInput}
            />
            <Text style={styles.label}>Caption and hashtags · exact outgoing copy</Text>
            {!!finalCopyError(post.platform, captionDraft) && (
              <Text accessibilityRole="alert">{finalCopyError(post.platform, captionDraft)}</Text>
            )}
            <TextInput
              accessibilityLabel="Caption"
              editable={copyEditable && !saving && !assigningAccount && !aiAction}
              value={captionDraft}
              onChangeText={setCaptionDraft}
              multiline
              style={styles.input}
            />
            {copyEditable ? (
              <Button
                label={saving ? "Saving…" : "Save copy"}
                secondary
                onPress={saving || assigningAccount || aiAction ? undefined : saveCopy}
              />
            ) : (
              <Text style={styles.body}>
                {["review_ready", "regenerating"].includes(post.status)
                  ? "Copy becomes editable when generation finishes."
                  : scheduled
                    ? "Editing scheduled copy requires review and calendar permissions."
                    : "This post is read-only in its current state or for your role."}
              </Text>
            )}
          </EssentialSection>

          <EssentialSection title="Publishing account">
            {socialAccounts.length ? (
              <View style={styles.accountList}>
                {socialAccounts.map((account: any) => {
                  const active = account.id === post.socialAccountId;
                  return (
                    <Pressable
                      key={account.id}
                      disabled={assigningAccount || !editable}
                      onPress={editable ? () => assignAccount(account.id) : undefined}
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
                No connected {post.platform} account is available for this client. Connect one from
                More → Social connections before publishing.
              </Text>
            )}
          </EssentialSection>

          {!!creative?.score && (
            <EssentialSection title={`SparQ Score · ${creative.score.overall}`} defaultOpen={false}>
              {!!creative.score.rationale && (
                <Text style={styles.body}>{creative.score.rationale}</Text>
              )}
              <View style={styles.scoreGrid}>
                {[
                  ["Brand match", creative.score.brand_match],
                  ["Readability", creative.score.readability],
                  ["Platform fit", creative.score.platform_fit],
                  ["CTA", creative.score.cta_strength],
                  ["Composition", creative.score.composition],
                  ["Caption", creative.score.caption_quality],
                  ["Compliance", creative.score.compliance],
                ].map(([label, value]) => (
                  <View key={String(label)} style={styles.scoreMetric}>
                    <Text style={styles.scoreMetricValue}>{String(value)}</Text>
                    <Text style={styles.scoreMetricLabel}>{String(label)}</Text>
                  </View>
                ))}
              </View>
            </EssentialSection>
          )}

          <Card subtle>
            <Text style={styles.label}>Recommended slot · {timezone}</Text>
            <Text style={styles.heading}>
              {post.suggestedPublishAt
                ? new Date(post.suggestedPublishAt).toLocaleString(undefined, {
                    timeZone: timezone,
                  })
                : "Not selected"}
            </Text>
          </Card>

          {editable && (
            <View style={styles.reviewActions}>
              <View style={styles.reviewAction}>
                <Button
                  label={saving ? "Working…" : "Request changes"}
                  secondary
                  onPress={saving || aiAction ? undefined : reject}
                />
              </View>
              <View style={styles.reviewAction}>
                <Button
                  label={saving ? "Approving…" : "Approve post"}
                  onPress={
                    saving || aiAction || !post.socialAccountId || post.artworkReady === false
                      ? undefined
                      : approve
                  }
                />
              </View>
            </View>
          )}
        </View>
      </View>

      {reviewable && can("ai_edit", post.clientId) && (
        <EssentialSection title="AI change request">
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
                label={aiAction === "rewrite" ? "Rewriting…" : "Rewrite caption"}
                onPress={
                  aiAction || post.status === "regenerating" ? undefined : () => runAi("rewrite")
                }
                secondary
              />
            </View>
            <View style={styles.aiButton}>
              <Button
                label={aiAction === "image" ? "Editing graphic…" : "Edit graphic with AI"}
                onPress={
                  aiAction || post.status === "regenerating" ? undefined : () => runAi("image")
                }
                secondary
              />
            </View>
            <View style={styles.aiButton}>
              <Button
                label={aiAction === "regenerate" ? "Regenerating…" : "Regenerate post"}
                onPress={
                  aiAction || post.status === "regenerating" ? undefined : () => runAi("regenerate")
                }
                secondary
              />
            </View>
          </View>
        </EssentialSection>
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 23,
    fontWeight: "700",
  },
  reviewGrid: {
    gap: spacing.md,
  },
  reviewGridWide: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  mediaCard: {
    minWidth: 0,
    padding: 10,
  },
  copyColumn: {
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
    fontWeight: "700",
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
  singleInput: {
    minHeight: 48,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 15,
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
    fontWeight: "700",
  },
  accountNameActive: {
    color: colors.white,
  },
  accountWarning: {
    color: colors.warning,
    lineHeight: 20,
    fontWeight: "700",
  },
  reviewActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  reviewAction: {
    flexGrow: 1,
    flexBasis: 180,
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
  scoreGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  scoreMetric: {
    flexGrow: 1,
    flexBasis: 110,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  scoreMetricValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  scoreMetricLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  retry: {
    color: colors.primary,
    fontWeight: "800",
  },
});

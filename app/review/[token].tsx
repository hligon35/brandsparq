import { EssentialSection } from "@/components/essential";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { renderFinalCopy, finalCopyError } from "@/shared/final-copy";
import { EditConflict, isEditConflict } from "@/components/edit-conflict";
import { Alert } from "@/components/feedback";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { BrandLogo } from "@/components/brand";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";

type Action = "save" | "reject" | "regenerate" | "approve" | null;

export default function PublicReviewScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [conflict, setConflict] = useState(false);
  const entityRef = useRef(token);
  entityRef.current = token;
  const loadVersion = useRef(0);
  const [post, setPost] = useState<any>();
  const [headline, setHeadline] = useState("");
  const [caption, setCaption] = useState("");
  const [comment, setComment] = useState("");
  const [instruction, setInstruction] = useState("");
  const [working, setWorking] = useState<Action>(null);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const { wide } = useResponsive();
  const { markSaved } = useUnsavedChanges(
    { headline, caption, comment, instruction },
    !!post && !approved,
    (saved) => {
      setHeadline(saved.headline);
      setCaption(saved.caption);
      setComment(saved.comment);
      setInstruction(saved.instruction);
    },
  );

  async function load() {
    const version = ++loadVersion.current;
    setConflict(false);
    if (!token) return;
    setError("");
    try {
      const result = await api.getPublicReview(token);
      if (version !== loadVersion.current || entityRef.current !== token) return;
      markSaved({
        headline: result.data.headline || result.data.title || "",
        caption: renderFinalCopy(result.data.caption || "", result.data.hashtags),
        comment: "",
        instruction: "",
      });
      setComment("");
      setInstruction("");
      setPost(result.data);
      setHeadline(result.data.headline || result.data.title || "");
      setCaption(renderFinalCopy(result.data.caption || "", result.data.hashtags));
    } catch (err) {
      if (version !== loadVersion.current || entityRef.current !== token) return;
      if (isEditConflict(err)) setConflict(true);
      setError(err instanceof Error ? err.message : "This review link is unavailable.");
    }
  }

  useEffect(() => {
    void load();
    return () => {
      loadVersion.current++;
    };
  }, [token]);

  useEffect(() => {
    if (post?.status !== "regenerating") return;
    const timer = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [post?.status, token]);

  async function persistCopy(includeComment = false) {
    const identity = token;
    const saved = await api.editPublicReview(token, {
      headline,
      caption,
      hashtags: [],
      comment: includeComment ? comment : "",
      expectedRevision: post.content_revision,
    });
    if (entityRef.current !== identity)
      throw new Error("The review link changed. Reload before continuing.");
    // If the next action fails, retry against the revision we just saved.
    setPost((current: any) => ({
      ...current,
      headline,
      title: headline,
      caption,
      hashtags: [],
      content_revision: saved.revision,
    }));
    return saved;
  }

  async function save() {
    if (!token) return;
    setWorking("save");
    try {
      await persistCopy(true);
      setComment("");
      await load();
    } catch (err) {
      if (isEditConflict(err)) setConflict(true);
      Alert.alert("Unable to save", err instanceof Error ? err.message : "Try again.");
    } finally {
      setWorking(null);
    }
  }

  async function reject() {
    if (!token) return;
    setWorking("reject");
    try {
      await persistCopy();
      await api.rejectPublicReview(token, comment || "Changes requested.");
      await load();
      Alert.alert(
        "Changes requested",
        "The post remains in review and can be regenerated from this link.",
      );
    } catch (err) {
      if (isEditConflict(err)) setConflict(true);
      Alert.alert("Unable to reject", err instanceof Error ? err.message : "Try again.");
    } finally {
      setWorking(null);
    }
  }

  async function regenerate() {
    if (!token) return;
    setWorking("regenerate");
    try {
      await persistCopy();
      await api.regeneratePublicReview(token, instruction || comment || undefined);
      setInstruction("");
      setComment("");
      await load();
    } catch (err) {
      if (isEditConflict(err)) setConflict(true);
      Alert.alert("Unable to regenerate", err instanceof Error ? err.message : "Try again.");
    } finally {
      setWorking(null);
    }
  }

  async function approve() {
    if (!token) return;
    setWorking("approve");
    try {
      const saved = await persistCopy(true);
      await api.approvePublicReview(token, saved.revision);
      setApproved(true);
    } catch (err) {
      if (isEditConflict(err)) setConflict(true);
      Alert.alert("Approval failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <PageScroll>
      {conflict && <EditConflict busy={working !== null} onReload={load} />}
      <View style={styles.brand}>
        <BrandLogo compact />
      </View>

      {approved ? (
        <Card style={styles.approvedCard}>
          <View style={styles.approvedMark}>
            <Text style={styles.approvedCheck}>✓</Text>
          </View>
          <Text style={styles.approvedTitle}>Approved</Text>
          <Text style={styles.sub}>
            This post has been added to the official marketing calendar.
          </Text>
        </Card>
      ) : error ? (
        <Card subtle>
          <Text style={styles.heading}>Review link unavailable</Text>
          <Text style={styles.sub}>{error}</Text>
          <Button label="Try again" secondary onPress={load} />
        </Card>
      ) : post ? (
        <>
          <PageHeader
            title={post.client_name}
            subtitle={String(post.platform).toUpperCase()}
            action={<StatusBadge label={post.status} />}
          />

          <View style={[styles.grid, wide && styles.gridWide]}>
            <Card style={styles.mediaCard}>
              {post.image_url ? (
                <Image source={{ uri: post.image_url }} style={styles.image} resizeMode="contain" />
              ) : (
                <View style={styles.previewWrap}>
                  <Text style={styles.preview}>GRAPHIC GENERATION PENDING</Text>
                </View>
              )}
            </Card>

            <View style={styles.copyColumn}>
              {post.artwork_ready === false && (
                <Text accessibilityRole="alert">
                  Final artwork is missing. Ask the workspace to complete the graphic before
                  approval. Caption edits can still be saved.
                </Text>
              )}
              <EssentialSection
                title="Final publication copy"
                summary="Check the graphic and branding. AI can alter logos."
                collapsible={false}
              >
                <Text style={styles.label}>Headline</Text>
                <TextInput
                  accessibilityLabel="Headline"
                  editable={
                    !working && ["awaiting_approval", "edit_requested"].includes(post.status)
                  }
                  value={headline}
                  onChangeText={setHeadline}
                  style={styles.input}
                />
                <Text style={styles.label}>Caption and hashtags · exact outgoing copy</Text>
                {!!finalCopyError(post.platform, caption) && (
                  <Text accessibilityRole="alert">{finalCopyError(post.platform, caption)}</Text>
                )}
                <TextInput
                  accessibilityLabel="Caption"
                  editable={
                    !working && ["awaiting_approval", "edit_requested"].includes(post.status)
                  }
                  value={caption}
                  onChangeText={setCaption}
                  multiline
                  style={[styles.input, styles.multiline]}
                />
                <Button
                  label={working === "save" ? "Saving…" : "Save edits"}
                  secondary
                  onPress={
                    working || !["awaiting_approval", "edit_requested"].includes(post.status)
                      ? undefined
                      : save
                  }
                />
              </EssentialSection>

              <Card subtle>
                <Text style={styles.label}>Suggested publish time</Text>
                <Text style={styles.heading}>
                  {post.suggested_publish_at
                    ? new Date(post.suggested_publish_at).toLocaleString(undefined, {
                        timeZone: post.client_timezone || "UTC",
                      })
                    : "Not selected"}
                  {` · ${post.client_timezone || "UTC"}`}
                </Text>
              </Card>

              <EssentialSection title="Feedback">
                <TextInput
                  editable={!working && post.status !== "regenerating"}
                  value={comment}
                  onChangeText={setComment}
                  multiline
                  placeholder="Comment or reason for changes"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.multiline]}
                />
                <TextInput
                  editable={!working && post.status !== "regenerating"}
                  value={instruction}
                  onChangeText={setInstruction}
                  multiline
                  placeholder="Optional regeneration instruction"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.multiline]}
                />
                <View style={styles.actions}>
                  <View style={styles.action}>
                    <Button
                      label={working === "reject" ? "Requesting…" : "Request changes"}
                      secondary
                      onPress={working || post.status === "regenerating" ? undefined : reject}
                    />
                  </View>
                  <View style={styles.action}>
                    <Button
                      label={working === "regenerate" ? "Regenerating…" : "Regenerate"}
                      secondary
                      onPress={working || post.status === "regenerating" ? undefined : regenerate}
                    />
                  </View>
                </View>
              </EssentialSection>

              <Button
                label={working === "approve" ? "Approving…" : "Approve and add to calendar"}
                onPress={
                  working || post.status === "regenerating" || post.artwork_ready === false
                    ? undefined
                    : approve
                }
              />
            </View>
          </View>
        </>
      ) : (
        <Card subtle>
          <Text style={styles.sub}>Loading review…</Text>
        </Card>
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  brand: { marginBottom: spacing.sm },
  grid: { gap: spacing.md },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  mediaCard: { flex: 1.05, padding: 10 },
  copyColumn: { flex: 0.95, minWidth: 0, gap: spacing.md },
  image: {
    width: "100%",
    aspectRatio: 4 / 5,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  previewWrap: {
    aspectRatio: 4 / 5,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  preview: { color: colors.muted, textAlign: "center", fontWeight: "800" },
  heading: { color: colors.text, fontSize: 17, lineHeight: 24, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  label: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  input: {
    minHeight: 48,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
  },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  action: { flexGrow: 1, flexBasis: 180 },
  approvedCard: {
    maxWidth: 620,
    alignSelf: "center",
    width: "100%",
    alignItems: "center",
    paddingVertical: 50,
  },
  approvedMark: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#E7F8F1",
    alignItems: "center",
    justifyContent: "center",
  },
  approvedCheck: { color: colors.success, fontSize: 30, fontWeight: "700" },
  approvedTitle: { color: colors.text, fontSize: 23, fontWeight: "700" },
});

import { useFocusedRefresh } from "@/hooks/useFocusedRefresh";
import { useEditorDraft } from "@/hooks/useEditorDraft";
import { editorDraftKey } from "@/shared/editor-draft";
import { EditorDraftNotice } from "@/components/editor-draft-notice";
import { useAuth } from "@/auth/context";
import { EssentialSection } from "@/components/essential";
import { EditConflict, isEditConflict } from "@/components/edit-conflict";
import { GuardedLink as Link } from "@/hooks/useUnsavedChanges";
import { useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { api } from "@/api/client";
import { useCapabilities } from "@/auth/capabilities";
import { Alert, confirmAction } from "@/components/feedback";
import { Field, Choices, formStyles as styles } from "@/components/forms";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
export default function CampaignDetailScreen() {
  const { campaignId } = useLocalSearchParams<{ campaignId: string }>();
  const can = useCapabilities();
  const { user } = useAuth();
  const [conflict, setConflict] = useState(false);
  const entityRef = useRef(campaignId);
  entityRef.current = campaignId;
  const loadVersion = useRef(0);
  const [data, setData] = useState<any>();
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editor = useEditorDraft(
    editorDraftKey(user?.id || "anonymous", "campaign", campaignId),
    form,
    !!data && can("client_manage", data.campaign.client_id),
    setForm,
  );
  const { dirty } = editor;
  const refreshDraft = useRef("");
  refreshDraft.current = JSON.stringify(form);
  async function load(recover = false, isCurrent = () => true) {
    const started = refreshDraft.current;
    const version = ++loadVersion.current;
    setConflict(false);
    setError("");
    try {
      const { data } = await api.getCampaign(campaignId);
      if (
        version !== loadVersion.current ||
        entityRef.current !== campaignId ||
        !isCurrent() ||
        (recover && started !== refreshDraft.current)
      )
        return;
      setData(data);
      const c = data.campaign;
      const nextForm = {
        name: c.name,
        objective: c.objective || "",
        startsAt: c.starts_at?.slice(0, 10) || "",
        endsAt: c.ends_at?.slice(0, 10) || "",
        priority: String(c.priority || 0),
        notes: c.notes || "",
        status: c.status,
      };
      await editor.initialize(nextForm, {
        recover: recover && can("client_manage", c.client_id),
        clear: !recover,
        persist: can("client_manage", c.client_id),
      });
    } catch (e) {
      if (
        version !== loadVersion.current ||
        entityRef.current !== campaignId ||
        !isCurrent() ||
        (recover && started !== refreshDraft.current)
      )
        return;
      if (isEditConflict(e)) setConflict(true);
      setError(e instanceof Error ? e.message : "Unable to load campaign.");
    }
  }
  useFocusedRefresh(
    async (context) => {
      if (saving || editor.pending || editor.dirty) return;
      await load(true, context.current);
    },
    [campaignId],
  );

  async function save() {
    setSaving(true);
    try {
      await api.updateCampaign(campaignId, {
        ...form,
        priority: Number(form.priority),
        expectedRevision: data.campaign.workflow_revision,
      });
      if (entityRef.current !== campaignId) return;
      editor.markSaved(form);
      await editor.flush();
      setData((current: any) =>
        current
          ? {
              ...current,
              campaign: {
                ...current.campaign,
                workflow_revision: current.campaign.workflow_revision + 1,
              },
            }
          : current,
      );
      await load();
      Alert.alert("Campaign saved");
    } catch (e) {
      if (isEditConflict(e)) setConflict(true);
      Alert.alert("Unable to save", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }
  const [bulkResults, setBulkResults] = useState<{ postId: string; ok: boolean; error?: string }[]>(
    [],
  );
  async function bulk(action: "pause" | "resume" | "cancel" | "approve") {
    if (editor.pending || dirty) {
      Alert.alert(
        "Save campaign changes first",
        "Save or discard your edits before applying a delivery action.",
      );
      return;
    }
    if (
      !(await confirmAction(
        `${action[0].toUpperCase() + action.slice(1)} campaign posts?`,
        action === "approve"
          ? "Approve eligible review posts using their chosen destinations and campaign dates. Ineligible posts will be reported."
          : "Apply this action to eligible posts in this campaign. Published posts and active publishing claims are preserved; skipped or failed posts will be listed.",
        "Apply action",
      ))
    )
      return;
    setSaving(true);
    try {
      const result = await api.campaignPostAction(
        campaignId,
        action,
        Object.fromEntries(data.posts.map((p: any) => [p.id, p.content_revision])),
      );
      setBulkResults(result.results);
      await load();
    } catch (error) {
      if (isEditConflict(error)) setConflict(true);
      Alert.alert(
        "Unable to update campaign posts",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  const editable =
    !!data && editor.ready && !editor.pending && can("client_manage", data.campaign.client_id);
  return (
    <PageScroll>
      {conflict && <EditConflict busy={saving} onReload={() => load()} />}
      <EditorDraftNotice editor={editor} busy={saving} />
      <PageHeader
        title={data?.campaign.name || "Campaign"}
        eyebrow={data?.campaign.client_name || "Campaigns"}
        subtitle="Campaign plan and delivery."
      />
      {error ? (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <Button label="Try again" onPress={() => void load()} />
        </Card>
      ) : !data ? (
        <Text style={styles.text}>Loading campaign…</Text>
      ) : (
        <>
          <EssentialSection title="Campaign details">
            <StatusBadge label={form.status || "draft"} />
            {[
              ["name", "Campaign name"],
              ["objective", "Objective"],
              ["startsAt", "Start date (YYYY-MM-DD)"],
              ["endsAt", "End date (YYYY-MM-DD)"],
              ["priority", "Priority (0–100)"],
              ["notes", "Notes"],
            ].map(([key, label]) => (
              <Field
                key={key}
                label={label}
                value={form[key] || ""}
                editable={editable && !saving}
                multiline={key === "notes"}
                onChange={(value) => setForm((f) => ({ ...f, [key]: value }))}
              />
            ))}
            <Text style={styles.text}>
              Only active campaigns can schedule or deliver posts. Start and end dates bound
              delivery in the client's time zone (the end date includes that day). Priority orders
              campaign lists; it does not bypass calendar spacing or daily limits. Use the explicit
              actions below to pause, resume or cancel scheduled posts. Active publishing cannot be
              recalled.
            </Text>
            {editable && (
              <>
                <Choices
                  values={["draft", "active", "paused", "completed", "archived"]}
                  value={form.status}
                  disabled={saving}
                  onChange={(status) => setForm((f) => ({ ...f, status }))}
                />
                <Button
                  label={saving ? "Saving…" : "Save campaign"}
                  onPress={saving ? undefined : save}
                />
              </>
            )}
          </EssentialSection>
          <EssentialSection title="Delivery actions">
            {can("review", data.campaign.client_id) && (
              <Button
                label="Approve ready posts"
                onPress={saving ? undefined : () => bulk("approve")}
              />
            )}
            {can("calendar_manage", data.campaign.client_id) && (
              <>
                <Button
                  label="Pause scheduled posts"
                  secondary
                  onPress={saving ? undefined : () => bulk("pause")}
                />
                <Button
                  label="Resume approved paused posts"
                  secondary
                  onPress={saving ? undefined : () => bulk("resume")}
                />
                <Button
                  label="Cancel scheduled posts"
                  danger
                  onPress={saving ? undefined : () => bulk("cancel")}
                />
              </>
            )}
            {!!bulkResults.length && (
              <Text style={styles.text}>
                {bulkResults.filter((result) => result.ok).length} updated ·{" "}
                {bulkResults.filter((result) => !result.ok).length} skipped or failed
              </Text>
            )}
            {bulkResults
              .filter((result) => !result.ok)
              .map((result) => (
                <Text key={result.postId} style={styles.error}>
                  {data.posts.find((post: any) => post.id === result.postId)?.title ||
                    result.postId}
                  : {result.error}
                </Text>
              ))}
          </EssentialSection>
          {data.posts.map((post: any) => (
            <Card key={post.id}>
              <View style={styles.row}>
                <StatusBadge label={post.status} />
                <Text style={styles.text}>{post.platform}</Text>
              </View>
              <Text style={styles.text}>{post.title}</Text>
              <Text style={styles.text} numberOfLines={2}>
                {post.caption}
              </Text>
              <Link href={`/posts/${post.id}`} asChild>
                <Button label="Open post" secondary />
              </Link>
            </Card>
          ))}
          {!data.posts.length && <Text style={styles.text}>No posts in this campaign yet.</Text>}
        </>
      )}
    </PageScroll>
  );
}

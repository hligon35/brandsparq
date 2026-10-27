import { GuardedLink as Link, useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api } from "@/api/client";
import { useCapabilities } from "@/auth/capabilities";
import { Alert, confirmAction } from "@/components/feedback";
import { Field, Choices, formStyles as styles } from "@/components/forms";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
export default function CampaignDetailScreen() {
  const { campaignId } = useLocalSearchParams<{ campaignId: string }>();
  const can = useCapabilities();
  const [data, setData] = useState<any>();
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { markSaved, dirty } = useUnsavedChanges(
    form,
    !!data && can("client_manage", data.campaign.client_id),
    setForm,
  );
  async function load() {
    setError("");
    try {
      const { data } = await api.getCampaign(campaignId);
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
      setForm(nextForm);
      markSaved(nextForm);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load campaign.");
    }
  }
  useEffect(() => {
    void load();
  }, [campaignId]);
  async function save() {
    setSaving(true);
    try {
      await api.updateCampaign(campaignId, { ...form, priority: Number(form.priority) });
      await load();
      Alert.alert("Campaign saved");
    } catch (e) {
      Alert.alert("Unable to save", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }
  const [bulkResults, setBulkResults] = useState<{ postId: string; ok: boolean; error?: string }[]>(
    [],
  );
  async function bulk(action: "pause" | "resume" | "cancel" | "approve") {
    if (dirty) {
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
      const result = await api.campaignPostAction(campaignId, action);
      setBulkResults(result.results);
      await load();
    } catch (error) {
      Alert.alert(
        "Unable to update campaign posts",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  const editable = !!data && can("client_manage", data.campaign.client_id);
  return (
    <PageScroll>
      <PageHeader
        title={data?.campaign.name || "Campaign"}
        eyebrow={data?.campaign.client_name || "Campaigns"}
        subtitle="Manage campaign details and open its posts."
      />
      {error ? (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <Button label="Try again" onPress={load} />
        </Card>
      ) : !data ? (
        <Text style={styles.text}>Loading campaign…</Text>
      ) : (
        <>
          <Card>
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
          </Card>
          <Card>
            <Text style={styles.text}>Campaign delivery actions</Text>
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
          </Card>
          {data.posts.map((post: any) => (
            <Card key={post.id}>
              <View style={styles.row}>
                <StatusBadge label={post.status} />
                <Text style={styles.text}>{post.platform}</Text>
              </View>
              <Text style={styles.text}>{post.title}</Text>
              <Text style={styles.text}>{post.caption}</Text>
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

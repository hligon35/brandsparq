import { GuardedLink as Link, useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api } from "@/api/client";
import { useCapabilities } from "@/auth/capabilities";
import { Alert } from "@/components/feedback";
import { Field, Choices, formStyles as styles } from "@/components/forms";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
export default function CampaignDetailScreen() {
  const { campaignId } = useLocalSearchParams<{ campaignId: string }>();
  const can = useCapabilities();
  const [data, setData] = useState<any>();
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { markSaved } = useUnsavedChanges(
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
              Campaign status organizes your work. Pause scheduled posts from Calendar to stop
              delivery.
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

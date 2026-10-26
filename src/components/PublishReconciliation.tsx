import { useState } from "react";
import { Text, View } from "react-native";
import { api } from "@/api/client";
import { Alert, confirmAction } from "@/components/feedback";
import { Choices, Field, formStyles } from "@/components/forms";
import { Button } from "@/components/ui";

export function PublishReconciliation({
  post,
  onResolved,
}: {
  post: { id: string; title: string; publish_version: number };
  onResolved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("Published");
  const [providerPostId, setProviderPostId] = useState("");
  const [evidence, setEvidence] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (
      !(await confirmAction(
        `Reconcile ${post.title}?`,
        outcome === "Published"
          ? "Record this provider post as published. This will not send another post."
          : "Confirm you checked the correct provider account and verified no post exists. A separate explicit retry will become available.",
        "Record outcome",
      ))
    )
      return;
    setSaving(true);
    try {
      await api.reconcilePublish(post.id, {
        publishVersion: post.publish_version,
        outcome: outcome === "Published" ? "published" : "absent",
        providerPostId: providerPostId.trim(),
        evidence: evidence.trim(),
      });
      await onResolved();
    } catch (error) {
      Alert.alert(
        "Unable to reconcile",
        error instanceof Error ? error.message : "Refresh and try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!open)
    return <Button label="Reconcile outcome" small secondary onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: 12, width: "100%" }}>
      <Text style={formStyles.text}>
        Check this post in the correct provider account before recording an outcome. Include the
        account, time checked, and provider URL or verification details in the evidence.
      </Text>
      <Choices
        values={["Published", "Verified absent"]}
        value={outcome}
        onChange={setOutcome}
        disabled={saving}
      />
      {outcome === "Published" && (
        <Field
          label="Provider post ID"
          value={providerPostId}
          onChange={setProviderPostId}
          editable={!saving}
        />
      )}
      <Field
        label="Provider verification evidence"
        value={evidence}
        onChange={setEvidence}
        multiline
        editable={!saving}
      />
      <Button
        label={saving ? "Recording…" : "Record verified outcome"}
        onPress={
          saving ||
          evidence.trim().length < 20 ||
          (outcome === "Published" && !providerPostId.trim())
            ? undefined
            : save
        }
      />
      <Button
        label="Cancel reconciliation"
        secondary
        onPress={saving ? undefined : () => setOpen(false)}
      />
    </View>
  );
}

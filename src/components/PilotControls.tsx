import { TimePicker } from "./pickers";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, SectionTitle, StatusBadge } from "./ui";
import { colors, radius, spacing } from "@/theme/tokens";
import {
  PILOT_EVIDENCE,
  type PilotDestination,
  type PilotEvidence,
  type PilotOverview,
} from "@/shared/pilot";

export function PilotControls() {
  const [pilot, setPilot] = useState<PilotOverview>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [destinations, setDestinations] = useState<PilotDestination[]>([]);
  const [commit, setCommit] = useState("");
  const [end, setEnd] = useState("");
  const [evidence, setEvidence] = useState<Partial<PilotEvidence>>({});
  function apply(next: PilotOverview) {
    setPilot(next);
    setDestinations(next.destinations);
    setCommit(next.releaseCommit || "");
    setEnd(next.endsAt || "");
    setEvidence(next.evidence);
  }
  async function load() {
    setLoading(true);
    setError("");
    try {
      apply((await api.getPilot()).data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load pilot controls.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(mode: "hold" | "supervised") {
    if (!pilot) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await api.configurePilot({
        mode,
        expectedRevision: pilot.revision,
        endsAt: end,
        releaseCommit: commit.trim(),
        evidence,
        destinations,
      });
      apply(result.data);
      setEditing(false);
      setMessage(
        mode === "hold"
          ? "Publishing held. Unclaimed scheduled posts are paused."
          : "Supervised pilot saved. Posts remain paused until reviewed and explicitly published by an owner.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save pilot settings.");
    } finally {
      setSaving(false);
    }
  }
  function choose(destination: PilotDestination) {
    const selected = destinations.some((d) => d.socialAccountId === destination.socialAccountId);
    setDestinations((current) =>
      selected
        ? current.filter((d) => d.socialAccountId !== destination.socialAccountId)
        : [...current.filter((d) => d.clientId !== destination.clientId), destination],
    );
  }
  return (
    <Card>
      <SectionTitle
        title="Supervised pilot"
        subtitle="Owner controls for limited client publishing and new invitations."
      />
      {loading ? (
        <Text style={styles.muted}>Loading pilot controls…</Text>
      ) : (
        <>
          {pilot && (
            <>
              <StatusBadge
                label={
                  pilot.expired
                    ? "Pilot expired · publishing held"
                    : pilot.mode === "normal"
                      ? "Pilot not enabled"
                      : pilot.mode === "hold"
                        ? "Publishing held"
                        : "Supervised pilot active"
                }
              />
              <Text style={styles.muted}>
                {pilot.mode === "normal"
                  ? "Existing workspace rules still apply. Enable a hold before preparing live acceptance."
                  : "One approved destination per client, up to two clients, and one publishing execution per client per UTC day. Every publish requires an active owner."}
              </Text>
              {pilot.endsAt && (
                <Text style={styles.muted}>
                  Pilot ends {new Date(pilot.endsAt).toLocaleString()}. Expiration keeps publishing
                  held.
                </Text>
              )}
              {pilot.inFlight > 0 && (
                <Text style={styles.warning}>
                  {pilot.inFlight} publishing job(s) already started. A hold prevents new claims;
                  check the provider before retrying any uncertain result.
                </Text>
              )}
              <View style={styles.actions}>
                <Button
                  label={saving ? "Saving…" : "Hold publishing"}
                  secondary
                  small
                  onPress={saving ? undefined : () => save("hold")}
                />
                <Button
                  label={editing ? "Close configuration" : "Configure supervised pilot"}
                  secondary
                  small
                  onPress={saving ? undefined : () => setEditing(!editing)}
                />
              </View>
              {!!message && (
                <Text accessibilityRole="alert" style={styles.success}>
                  {message}
                </Text>
              )}
              {editing && (
                <View style={styles.form}>
                  <Text style={styles.label}>Accepted destinations</Text>
                  <Text style={styles.muted}>
                    Select one connected account for each of one or two clients.
                  </Text>
                  {!pilot.availableDestinations.length && (
                    <Text style={styles.muted}>
                      No connected destinations are available. Complete provider acceptance before
                      enabling a pilot.
                    </Text>
                  )}
                  {pilot.availableDestinations.map((d) => {
                    const checked = destinations.some(
                      (row) => row.socialAccountId === d.socialAccountId,
                    );
                    return (
                      <Pressable
                        key={d.socialAccountId}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked, disabled: saving }}
                        onPress={saving ? undefined : () => choose(d)}
                        style={[styles.choice, checked && styles.chosen]}
                      >
                        <Text style={styles.label}>
                          {checked ? "Selected · " : ""}
                          {d.clientName}
                        </Text>
                        <Text style={styles.muted}>
                          {d.platform} · {d.accountName || "Connected account"}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Text style={styles.label}>Accepted release commit</Text>
                  <TextInput
                    accessibilityLabel="Accepted release commit"
                    style={styles.input}
                    value={commit}
                    onChangeText={setCommit}
                    autoCapitalize="none"
                    editable={!saving}
                    placeholder="40-character Git commit"
                  />
                  <Text style={styles.label}>Pilot end date (UTC)</Text>
                  <TextInput
                    accessibilityLabel="Pilot end date (UTC)"
                    style={styles.input}
                    value={end.slice(0, 10)}
                    placeholder="YYYY-MM-DD"
                    onChangeText={(date) =>
                      setEnd(date + "T" + (end.slice(11, 16) || "12:00") + ":00Z")
                    }
                    editable={!saving}
                  />
                  <TimePicker
                    label="Pilot end time (UTC)"
                    value={end.slice(11, 16) || "12:00"}
                    disabled={saving}
                    onChange={(time) =>
                      setEnd(
                        (end.slice(0, 10) || new Date().toISOString().slice(0, 10)) +
                          "T" +
                          time +
                          ":00Z",
                      )
                    }
                  />
                  <Text style={styles.muted}>
                    Choose a future end within seven days. Required evidence records your completed
                    checks; saving these references does not run the checks.
                  </Text>
                  {PILOT_EVIDENCE.map((item) => (
                    <View key={item.id} style={styles.field}>
                      <Text style={styles.label}>{item.label} evidence</Text>
                      <TextInput
                        accessibilityLabel={`${item.label} evidence`}
                        style={styles.input}
                        value={evidence[item.id] || ""}
                        onChangeText={(value) =>
                          setEvidence((current) => ({ ...current, [item.id]: value }))
                        }
                        autoCapitalize="none"
                        keyboardType="url"
                        editable={!saving}
                        placeholder="Private HTTPS report URL, without tokens"
                      />
                    </View>
                  ))}
                  <Button
                    label={saving ? "Saving…" : "Save supervised pilot"}
                    onPress={saving ? undefined : () => save("supervised")}
                  />
                </View>
              )}
            </>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Button
            label="Reload pilot controls"
            secondary
            small
            onPress={saving ? undefined : load}
          />
        </>
      )}
    </Card>
  );
}
const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  form: { gap: spacing.sm, marginTop: spacing.md },
  field: { gap: 4 },
  label: { color: colors.text, fontWeight: "700" },
  muted: { color: colors.muted, lineHeight: 20 },
  warning: { color: colors.warning, lineHeight: 20 },
  error: { color: colors.danger, lineHeight: 20 },
  success: { color: colors.success, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: 48,
    color: colors.text,
    backgroundColor: colors.surface2,
  },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 48,
    gap: 4,
  },
  chosen: { borderColor: colors.primary, backgroundColor: colors.surface2 },
});

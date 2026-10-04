import { useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, SectionTitle } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";

export default function SettingsScreen() {
  const [workspace, setWorkspace] = useState<any>({});
  const [notifications, setNotifications] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ data }) => {
        setWorkspace({
          timezone: data.workspace?.timezone || "America/Indiana/Indianapolis",
          defaultPrepublishMinutes: data.workspace?.default_prepublish_minutes ?? 30,
          defaultNoResponsePolicy: data.workspace?.default_no_response_policy || "auto_publish",
          minPostSpacingMinutes: data.workspace?.min_post_spacing_minutes ?? 180,
          maxPostsPerDay: data.workspace?.max_posts_per_day ?? 3,
          preferredWindows: data.workspace?.preferred_windows || ["09:00-11:00", "17:00-20:00"],
          blackoutWindows: data.workspace?.blackout_windows || [],
          analyticsRefreshHours: data.workspace?.analytics_refresh_hours ?? 6,
        });
        setNotifications({
          emailEnabled: Boolean(data.notifications?.email_enabled ?? 1),
          pushEnabled: Boolean(data.notifications?.push_enabled ?? 1),
          inAppEnabled: Boolean(data.notifications?.in_app_enabled ?? 1),
          reviewEmailEnabled: Boolean(data.notifications?.review_email_enabled ?? 1),
          reviewReadyEnabled: Boolean(data.notifications?.review_ready_enabled ?? 1),
          prepublishEnabled: Boolean(data.notifications?.prepublish_enabled ?? 1),
          publishSuccessEnabled: Boolean(data.notifications?.publish_success_enabled ?? 1),
          publishFailureEnabled: Boolean(data.notifications?.publish_failure_enabled ?? 1),
          prepublishMinutes: data.notifications?.prepublish_minutes ?? 30,
          noResponsePolicy: data.notifications?.no_response_policy || "auto_publish",
        });
      })
      .catch((error) => {
        Alert.alert(
          "Unable to load settings",
          error instanceof Error ? error.message : "Try again.",
        );
      });
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.saveSettings({ workspace, notifications });
      Alert.alert(
        "Settings saved",
        "BrandSparQ will use these rules for scheduling and notifications.",
      );
    } catch (e) {
      Alert.alert("Unable to save", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  const numberField = (label: string, key: string, value: any, onChange: (v: number) => void) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={String(value ?? "")}
        onChangeText={(v) => onChange(Number(v) || 0)}
      />
    </View>
  );

  const toggle = (label: string, key: string) => (
    <View style={styles.toggle} key={key}>
      <Text style={styles.toggleText}>{label}</Text>
      <Switch
        value={Boolean(notifications[key])}
        onValueChange={(value) => setNotifications({ ...notifications, [key]: value })}
        trackColor={{ true: colors.primary }}
      />
    </View>
  );

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Workspace behavior"
        title="Settings"
        subtitle="Control scheduling rules, alert timing, analytics refresh, and what BrandSparQ should do if you do not respond before publication."
      />
      <Card>
        <SectionTitle
          title="Scheduling"
          subtitle="Default rules apply to every client unless you later override them."
        />
        <View style={styles.grid}>
          <View style={styles.field}>
            <Text style={styles.label}>Timezone</Text>
            <TextInput
              style={styles.input}
              value={workspace.timezone || ""}
              onChangeText={(v) => setWorkspace({ ...workspace, timezone: v })}
            />
          </View>
          {numberField(
            "Minimum spacing (minutes)",
            "minPostSpacingMinutes",
            workspace.minPostSpacingMinutes,
            (v) => setWorkspace({ ...workspace, minPostSpacingMinutes: v }),
          )}
          {numberField("Maximum posts per day", "maxPostsPerDay", workspace.maxPostsPerDay, (v) =>
            setWorkspace({ ...workspace, maxPostsPerDay: v }),
          )}
          {numberField(
            "Analytics refresh (hours)",
            "analyticsRefreshHours",
            workspace.analyticsRefreshHours,
            (v) => setWorkspace({ ...workspace, analyticsRefreshHours: v }),
          )}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Preferred windows</Text>
          <TextInput
            style={styles.input}
            value={(workspace.preferredWindows || []).join(", ")}
            onChangeText={(v) =>
              setWorkspace({
                ...workspace,
                preferredWindows: v
                  .split(",")
                  .map((x: string) => x.trim())
                  .filter(Boolean),
              })
            }
            placeholder="09:00-11:00, 17:00-20:00"
            placeholderTextColor={colors.muted}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Blackout windows</Text>
          <TextInput
            style={styles.input}
            value={(workspace.blackoutWindows || []).join(", ")}
            onChangeText={(v) =>
              setWorkspace({
                ...workspace,
                blackoutWindows: v
                  .split(",")
                  .map((x: string) => x.trim())
                  .filter(Boolean),
              })
            }
            placeholder="12:00-14:00"
            placeholderTextColor={colors.muted}
          />
        </View>
      </Card>

      <Card>
        <SectionTitle title="Notifications" subtitle="Choose how BrandSparQ contacts you." />
        {toggle("Email notifications", "emailEnabled")}
        {toggle("Push notifications", "pushEnabled")}
        {toggle("In-app notifications", "inAppEnabled")}
        {toggle("Review-link emails", "reviewEmailEnabled")}
        <Text style={styles.groupLabel}>Alert types</Text>
        {toggle("Content ready for review", "reviewReadyEnabled")}
        {toggle("Pre-publish decisions", "prepublishEnabled")}
        {toggle("Publish confirmations", "publishSuccessEnabled")}
        {toggle("Publish failures", "publishFailureEnabled")}
        {numberField(
          "Pre-publish alert (minutes)",
          "prepublishMinutes",
          notifications.prepublishMinutes,
          (v) => setNotifications({ ...notifications, prepublishMinutes: v }),
        )}
        <View style={styles.field}>
          <Text style={styles.label}>No-response policy</Text>
          <View style={styles.policyRow}>
            {["auto_publish", "hold", "skip"].map((policy) => (
              <Text
                key={policy}
                onPress={() => setNotifications({ ...notifications, noResponsePolicy: policy })}
                style={[
                  styles.policy,
                  notifications.noResponsePolicy === policy && styles.policyActive,
                ]}
              >
                {policy.replace("_", " ")}
              </Text>
            ))}
          </View>
        </View>
      </Card>

      <Button label={saving ? "Saving…" : "Save settings"} onPress={saving ? undefined : save} />
    </PageScroll>
  );
}
const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  field: { flexGrow: 1, flexBasis: 250, gap: 7 },
  label: { color: colors.textSoft, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  input: {
    minHeight: 48,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 15,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toggleText: { color: colors.text, fontWeight: "700" },
  groupLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.md,
  },
  policyRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  policy: {
    color: colors.textSoft,
    backgroundColor: colors.surface2,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    textTransform: "capitalize",
    overflow: "hidden",
  },
  policyActive: { backgroundColor: colors.primary, color: colors.white },
});

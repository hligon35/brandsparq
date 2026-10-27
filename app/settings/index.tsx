import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { TimezonePicker, TimeWindows } from "@/components/pickers";
import { useCapabilities } from "@/auth/capabilities";
import { Alert } from "@/components/feedback";
import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { registerThisDeviceForPush } from "@/notifications/register";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, SectionTitle } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";

export default function SettingsScreen() {
  const can = useCapabilities();
  const [workspace, setWorkspace] = useState<any>({});
  const [notifications, setNotifications] = useState<any>({});
  const [notificationBusy, setNotificationBusy] = useState(false);
  async function notificationAction(push: boolean) {
    setNotificationBusy(true);
    try {
      if (push) await registerThisDeviceForPush();
      else await api.testNotifications();
      Alert.alert(
        push ? "Push enabled" : "Test sent",
        push
          ? "This device can receive BrandSparQ alerts."
          : "A test was sent through your enabled channels.",
      );
    } catch (error) {
      Alert.alert(
        "Unable to complete request",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setNotificationBusy(false);
    }
  }
  const [saving, setSaving] = useState(false);
  const { markSaved } = useUnsavedChanges({ workspace, notifications }, true, (saved) => {
    setWorkspace(saved.workspace);
    setNotifications(saved.notifications);
  });
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const personalEditable = loaded && !saving;
  const editable = personalEditable && can("settings_manage");

  function load() {
    setLoadError("");
    return api
      .getSettings()
      .then(({ data }) => {
        const nextWorkspace = {
          timezone: data.workspace?.timezone || "America/Indiana/Indianapolis",
          defaultPrepublishMinutes: data.workspace?.default_prepublish_minutes ?? 30,
          defaultNoResponsePolicy: data.workspace?.default_no_response_policy || "auto_publish",
          minPostSpacingMinutes: data.workspace?.min_post_spacing_minutes ?? 180,
          maxPostsPerDay: data.workspace?.max_posts_per_day ?? 3,
          preferredWindows: data.workspace?.preferred_windows || ["09:00-11:00", "17:00-20:00"],
          blackoutWindows: data.workspace?.blackout_windows || [],
          analyticsRefreshHours: data.workspace?.analytics_refresh_hours ?? 6,
        };
        const nextNotifications = {
          emailEnabled: Boolean(data.notifications?.email_enabled ?? 1),
          pushEnabled: Boolean(data.notifications?.push_enabled ?? 1),
          inAppEnabled: Boolean(data.notifications?.in_app_enabled ?? 1),
          reviewEmailEnabled: Boolean(data.notifications?.review_email_enabled ?? 1),
          reviewReadyEnabled: Boolean(data.notifications?.review_ready_enabled ?? 1),
          prepublishEnabled: Boolean(data.notifications?.prepublish_enabled ?? 1),
          publishSuccessEnabled: Boolean(data.notifications?.publish_success_enabled ?? 1),
          publishFailureEnabled: Boolean(data.notifications?.publish_failure_enabled ?? 1),
        };
        setWorkspace(nextWorkspace);
        setNotifications(nextNotifications);
        markSaved({ workspace: nextWorkspace, notifications: nextNotifications });
        setLoaded(true);
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : "Unable to load settings.");
      });
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.saveSettings({ ...(can("settings_manage") ? { workspace } : {}), notifications });
      markSaved({ workspace, notifications });
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

  const numberField = (
    label: string,
    key: string,
    value: any,
    onChange: (v: number) => void,
    personal = false,
  ) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        editable={personal ? personalEditable : editable}
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
        accessibilityLabel={label}
        disabled={!personalEditable}
        value={Boolean(notifications[key])}
        onValueChange={(value) => setNotifications({ ...notifications, [key]: value })}
        trackColor={{ true: colors.primary }}
      />
    </View>
  );

  return (
    <PageScroll>
      {!!loadError && (
        <Card>
          <Text accessibilityRole="alert">{loadError}</Text>
          <Button label="Try again" onPress={load} />
        </Card>
      )}
      {!can("settings_manage") && <Text>Workspace settings are read-only for your role.</Text>}
      <PageHeader
        eyebrow="Workspace behavior"
        title="Settings"
        subtitle="Control scheduling rules, alert timing, analytics refresh, and what BrandSparQ should do if you do not respond before publication."
      />
      <Card>
        <SectionTitle
          title="Notification devices"
          subtitle="Register this device or send a test through your enabled channels."
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            {" "}
            <Button
              label="Enable push"
              secondary
              onPress={notificationBusy ? undefined : () => notificationAction(true)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Send test"
              secondary
              onPress={
                notificationBusy || !can("notifications_manage")
                  ? undefined
                  : () => notificationAction(false)
              }
            />
          </View>
        </View>
      </Card>
      <Card>
        <SectionTitle
          title="Scheduling"
          subtitle="Default rules apply to every client unless you later override them."
        />
        <View style={styles.grid}>
          <View style={styles.field}>
            <TimezonePicker
              disabled={!editable}
              value={workspace.timezone || ""}
              onChange={(v) => setWorkspace({ ...workspace, timezone: v })}
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
        <TimeWindows
          disabled={!editable}
          label="Preferred windows"
          values={workspace.preferredWindows || []}
          onChange={(preferredWindows) => setWorkspace({ ...workspace, preferredWindows })}
        />
        <TimeWindows
          disabled={!editable}
          label="Blackout windows"
          values={workspace.blackoutWindows || []}
          onChange={(blackoutWindows) => setWorkspace({ ...workspace, blackoutWindows })}
        />
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
      </Card>
      <Card>
        <SectionTitle
          title="Publishing safeguards"
          subtitle="Workspace controls. Personal alert choices never change publishing behavior."
        />
        {numberField(
          "Pre-publish alert (minutes)",
          "defaultPrepublishMinutes",
          workspace.defaultPrepublishMinutes,
          (v) => setWorkspace({ ...workspace, defaultPrepublishMinutes: v }),
        )}
        <View style={styles.field}>
          <Text style={styles.label}>No-response policy</Text>
          <View style={styles.policyRow}>
            {["auto_publish", "hold", "skip"].map((policy) => (
              <Text
                key={policy}
                onPress={
                  editable
                    ? () => setWorkspace({ ...workspace, defaultNoResponsePolicy: policy })
                    : undefined
                }
                style={[
                  styles.policy,
                  workspace.defaultNoResponsePolicy === policy && styles.policyActive,
                ]}
              >
                {policy.replace("_", " ")}
              </Text>
            ))}
          </View>
        </View>
      </Card>

      <Button
        label={saving ? "Saving…" : "Save settings"}
        onPress={!personalEditable ? undefined : save}
      />
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

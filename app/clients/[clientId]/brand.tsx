import { Link } from "expo-router";
import { useCapabilities } from "@/auth/capabilities";
import { TimezonePicker, ColorPicker } from "@/components/pickers";
import { logoColors } from "@/media/logoColors";
import { Alert } from "@/components/feedback";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, SectionTitle } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";

const fields = [
  ["voice", "Brand voice", true],
  ["audience", "Audience", true],
  ["tagline", "Tagline", false],
  ["website", "Website", false],
  ["preferredCtas", "Preferred CTAs", false],
  ["imageryPreferences", "Imagery preferences", true],
  ["postingRules", "Posting rules", true],
  ["restrictedWords", "Restricted words / claims", false],
  ["fonts", "Fonts / typography", false],
  ["brandExamples", "Approved copy examples", true],
  ["prohibitedVisualStyles", "Prohibited visual styles", true],
  ["competitorReferences", "Competitor references", true],
  ["brandVocabulary", "Brand vocabulary", true],
  ["hashtagPolicy", "Hashtag policy", true],
  ["targetLocations", "Target locations", false],
  ["platformRules", "Platform-specific rules", true],
] as const;

export default function BrandBrainScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const can = useCapabilities();
  const [clientActive, setClientActive] = useState(true);
  const editable = clientActive && can("brand_manage", clientId);
  const [brand, setBrand] = useState<Record<string, string>>({});
  const [name, setName] = useState("Brand Brain");
  const [timezone, setTimezone] = useState("");
  const [assets, setAssets] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { wide } = useResponsive();

  async function load() {
    if (!clientId) return;
    setError("");
    try {
      const [{ data }, assetResult] = await Promise.all([
        api.getBrand(clientId),
        api.getBrandAssets(clientId),
      ]);
      setClientActive(data.client_status === "active");
      setName(data.name || "Brand Brain");
      setTimezone(data.timezone || "");
      setBrand({
        logoPreference: data.logo_preference || "primary",
        voice: data.voice || "",
        audience: data.audience || "",
        tagline: data.tagline || "",
        website: data.website || "",
        preferredCtas: data.preferred_ctas || "",
        imageryPreferences: data.imagery_preferences || "",
        postingRules: data.posting_rules || "",
        restrictedWords: data.restricted_words || "",
        primaryColor: data.primary_color || "",
        secondaryColor: data.secondary_color || "",
        fonts: data.fonts || "",
        brandExamples: data.brand_examples || "",
        prohibitedVisualStyles: data.prohibited_visual_styles || "",
        competitorReferences: data.competitor_references || "",
        brandVocabulary: data.brand_vocabulary || "",
        hashtagPolicy: data.hashtag_policy || "",
        targetLocations: data.target_locations || "",
        platformRules: data.platform_rules || "",
      });
      setAssets(assetResult.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Brand Brain.");
    }
  }
  useEffect(() => {
    void load();
  }, [clientId]);

  async function save() {
    if (!clientId) return;
    setSaving(true);
    try {
      await Promise.all([
        api.saveBrand(clientId, brand),
        api.updateClient(clientId, { name, timezone }),
      ]);
      Alert.alert("Brand Brain saved", "Future generations will use these rules.");
    } catch (err) {
      Alert.alert("Unable to save", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function addAsset(role: "logo" | "alternate_logo" | "reference") {
    if (!clientId) return;
    setSaving(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        selectionLimit: 1,
        quality: 1,
      });
      if (result.canceled || !result.assets[0]) return;
      const file = result.assets[0];
      const uploaded = await api.uploadAsset(
        clientId,
        file.uri,
        file.fileName || `brand-${role}.png`,
        file.mimeType || "image/png",
      );
      await api.attachBrandAsset(clientId, uploaded.id, role, file.fileName || undefined);
      const extracted = role !== "reference" ? await logoColors(file.uri).catch(() => []) : [];
      setAssets((await api.getBrandAssets(clientId)).data);
      if (role !== "reference" && !extracted.length)
        Alert.alert("Logo uploaded", "Choose the brand colors manually for this image.");
      if (extracted.length)
        setBrand((current) => ({
          ...current,
          primaryColor: extracted[0],
          secondaryColor: extracted[1] || extracted[0],
        }));
    } catch (err) {
      Alert.alert("Unable to add brand asset", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Client intelligence"
        title={name}
        subtitle="These rules shape creative direction, captions, CTAs, and scheduling recommendations."
      />

      {error && (
        <Card subtle>
          <Text style={styles.errorTitle}>Brand Brain unavailable</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable onPress={load}>
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </Card>
      )}

      {(can("review", clientId) || can("client_manage", clientId)) && (
        <Link href={`/clients/${clientId}/reviewers`} asChild>
          <Button label="Manage reviewers" secondary />
        </Link>
      )}
      <Card>
        <SectionTitle
          title="Client profile"
          subtitle="Core identity used throughout the workspace."
        />
        <View style={[styles.colorRow, wide && styles.colorRowWide]}>
          <View style={styles.colorField}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              editable={editable}
              style={styles.input}
              value={name}
              onChangeText={setName}
            />
          </View>
          <View style={styles.colorField}>
            <TimezonePicker value={timezone} disabled={!editable} onChange={setTimezone} />
          </View>
        </View>
      </Card>

      <Card>
        <SectionTitle
          title="Brand assets"
          subtitle="Upload primary logos, alternate logos, and approved reference images."
        />
        {editable && (
          <View style={styles.assetActions}>
            {[
              { label: "Upload\nlogo", role: "logo" },
              { label: "Upload\nalternate logo", role: "alternate_logo" },
              { label: "Add reference\nimage", role: "reference" },
            ].map((item) => (
              <View key={item.role} style={styles.assetCell}>
                <Button
                  label={item.label}
                  secondary
                  onPress={
                    saving
                      ? undefined
                      : () => addAsset(item.role as "logo" | "alternate_logo" | "reference")
                  }
                />
              </View>
            ))}
            <View style={[styles.assetCell, { gap: 8 }]}>
              {["primary", "alternate"].map((value) => (
                <Button
                  key={value}
                  label={value}
                  secondary={brand.logoPreference !== value}
                  onPress={
                    saving
                      ? undefined
                      : () => setBrand((current) => ({ ...current, logoPreference: value }))
                  }
                />
              ))}
            </View>
          </View>
        )}
        {!!assets.length && (
          <View style={styles.assetList}>
            {assets.map((asset) => (
              <View key={asset.id} style={styles.assetRow}>
                <Text style={styles.assetName}>{asset.label || asset.filename}</Text>
                <Text style={styles.assetRole}>{String(asset.role).replace("_", " ")}</Text>
                {editable && (
                  <Button
                    label="Remove asset"
                    small
                    secondary
                    onPress={
                      saving
                        ? undefined
                        : async () => {
                            setSaving(true);
                            try {
                              await api.removeBrandAsset(clientId, asset.id);
                              await load();
                            } catch (e) {
                              Alert.alert(
                                "Unable to remove asset",
                                e instanceof Error ? e.message : "Try again.",
                              );
                            } finally {
                              setSaving(false);
                            }
                          }
                    }
                  />
                )}
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Brand colors"
          subtitle="Logo uploads select prominent colors. Tap a color to adjust it, then save Brand Brain."
        />
        <View style={{ flexDirection: "row", gap: 12 }}>
          {["primaryColor", "secondaryColor"].map((key, i) => (
            <View key={key} style={{ flex: 1 }}>
              <ColorPicker
                label={i === 0 ? "Primary" : "Secondary"}
                value={brand[key] || ""}
                disabled={!editable}
                onChange={(value) => setBrand((current) => ({ ...current, [key]: value }))}
              />
            </View>
          ))}
        </View>
      </Card>

      <View style={styles.grid}>
        {fields.map(([key, label, multiline]) => (
          <View key={key} style={[styles.gridItem, multiline && wide && styles.gridItemWide]}>
            <Card style={styles.fieldCard}>
              <Text style={styles.label}>{label}</Text>
              <TextInput
                editable={editable}
                accessibilityLabel={label}
                style={[styles.input, multiline && styles.multiline]}
                value={brand[key] || ""}
                onChangeText={(v) => setBrand({ ...brand, [key]: v })}
                placeholder={label}
                placeholderTextColor={colors.muted}
                multiline={multiline}
              />
            </Card>
          </View>
        ))}
      </View>

      {editable && (
        <View style={styles.saveWrap}>
          <Button
            label={saving ? "Saving…" : "Save Brand Brain"}
            onPress={saving ? undefined : save}
          />
        </View>
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  colorRow: { gap: spacing.md },
  colorRowWide: { flexDirection: "row" },
  colorField: { flex: 1, gap: 7 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  gridItem: { alignSelf: "flex-start", flexGrow: 1, flexBasis: 330, maxWidth: "100%" },
  gridItemWide: { flexBasis: 520 },
  fieldCard: { alignSelf: "stretch" },
  label: {
    color: colors.textSoft,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    minHeight: 50,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
  },
  multiline: { minHeight: 118, textAlignVertical: "top" },
  saveWrap: { alignSelf: "flex-end", minWidth: 220 },
  assetActions: { flexDirection: "row", flexWrap: "wrap", columnGap: "4%", rowGap: 12 },
  assetCell: { width: "48%", justifyContent: "center" },
  assetList: { gap: 8 },
  assetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  assetName: { color: colors.text, fontWeight: "700", flex: 1 },
  assetRole: { color: colors.muted, textTransform: "uppercase", fontSize: 11, fontWeight: "800" },
  errorTitle: { color: colors.text, fontSize: 20, fontWeight: "900" },
  errorBody: { color: colors.muted },
  retry: { color: colors.primary, fontWeight: "800" },
});

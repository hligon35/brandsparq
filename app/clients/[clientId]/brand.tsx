import { EssentialSection } from "@/components/essential";
import { EditConflict, isEditConflict } from "@/components/edit-conflict";
import { AssetThumbnail } from "@/components/asset-thumbnail";
import { GuardedLink as Link, useUnsavedChanges } from "@/hooks/useUnsavedChanges";

import { useCapabilities } from "@/auth/capabilities";
import { TimezonePicker, ColorPicker } from "@/components/pickers";
import { Ionicons } from "@expo/vector-icons";
import { Alert, confirmAction } from "@/components/feedback";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
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
  const [conflict, setConflict] = useState(false);
  const entityRef = useRef(clientId);
  entityRef.current = clientId;
  const loadVersion = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [clientActive, setClientActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState<number>();
  const editable = loaded && clientActive && !saving && can("brand_manage", clientId);
  const [brand, setBrand] = useState<Record<string, string>>({});
  const [name, setName] = useState("Brand Brain");
  const [timezone, setTimezone] = useState("");
  const [assets, setAssets] = useState<any[]>([]);
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const assetBusy = useRef(false);
  const savedProfile = useRef<{
    name: string;
    timezone: string;
    brand: Record<string, string>;
  } | null>(null);
  const [error, setError] = useState("");
  const { wide } = useResponsive();
  const { markSaved } = useUnsavedChanges(
    { name, timezone, brand },
    loaded && clientActive && can("brand_manage", clientId),
    (saved) => {
      setName(saved.name);
      setTimezone(saved.timezone);
      setBrand(saved.brand);
    },
  );

  function applyProfile(data: any) {
    setClientActive(data.client_status === undefined || data.client_status === "active");
    setName(data.name || "Brand Brain");
    setTimezone(data.timezone || "");
    const nextBrand = {
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
      tertiaryColor: data.tertiary_color || "",
      fonts: data.fonts || "",
      brandExamples: data.brand_examples || "",
      prohibitedVisualStyles: data.prohibited_visual_styles || "",
      competitorReferences: data.competitor_references || "",
      brandVocabulary: data.brand_vocabulary || "",
      hashtagPolicy: data.hashtag_policy || "",
      targetLocations: data.target_locations || "",
      platformRules: data.platform_rules || "",
    };
    setBrand(nextBrand);
    savedProfile.current = {
      name: data.name || "Brand Brain",
      timezone: data.timezone || "",
      brand: nextBrand,
    };
    markSaved(savedProfile.current);
    setRevision(data.revision);
    setLoaded(true);
  }

  async function load() {
    const version = ++loadVersion.current;
    setConflict(false);
    if (!clientId) return;
    setError("");
    try {
      const [{ data }, assetResult] = await Promise.all([
        api.getBrand(clientId),
        api.getBrandAssets(clientId),
      ]);
      if (version !== loadVersion.current || entityRef.current !== clientId) return;
      applyProfile(data);
      setAssets(assetResult.data);
    } catch (err) {
      if (version !== loadVersion.current || entityRef.current !== clientId) return;
      if (isEditConflict(err)) setConflict(true);
      setError(err instanceof Error ? err.message : "Unable to load Brand Brain.");
    }
  }
  useEffect(() => {
    void load();
    return () => {
      loadVersion.current++;
    };
  }, [clientId]);

  async function save() {
    if (!clientId) return;
    setSaving(true);
    try {
      const saved = await api.saveBrand(clientId, {
        ...brand,
        name,
        timezone,
        expectedRevision: revision,
      });
      if (entityRef.current !== clientId) return;
      applyProfile(saved.data);
      Alert.alert("Brand Brain saved", "Future generations will use these rules.");
    } catch (err) {
      if (isEditConflict(err)) setConflict(true);
      Alert.alert("Unable to save", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function addAsset(role: "logo" | "alternate_logo" | "reference") {
    if (!clientId || assetBusy.current) return;
    assetBusy.current = true;
    const version = loadVersion.current;
    setAssetMenuOpen(false);
    setSaving(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        selectionLimit: 1,
        quality: 1,
      });
      if (result.canceled || !result.assets[0] || version !== loadVersion.current) return;
      const file = result.assets[0];
      const uploaded = await api.uploadAsset(
        clientId,
        file.uri,
        file.fileName || `brand-${role}.png`,
        file.mimeType || "image/png",
      );
      if (version !== loadVersion.current) return;
      const attached = await api.attachBrandAsset(
        clientId,
        uploaded.id,
        role,
        revision!,
        file.fileName || undefined,
        role !== "reference" ? uploaded.palette : undefined,
      );
      if (entityRef.current !== clientId) return;
      setRevision(attached.revision);
      const extracted = attached.palette || [];
      if (role !== "reference" && !extracted.length)
        Alert.alert("Logo uploaded", "Choose the brand colors manually for this image.");
      if (extracted.length) {
        const palette = {
          primaryColor: extracted[0],
          secondaryColor: extracted[1] || "",
          tertiaryColor: extracted[2] || "",
        };
        setBrand((current) => ({ ...current, ...palette }));
        // Only the palette was persisted; keep other draft fields dirty.
        if (savedProfile.current) {
          savedProfile.current = {
            ...savedProfile.current,
            brand: { ...savedProfile.current.brand, ...palette },
          };
          markSaved(savedProfile.current);
        }
      }
      const refreshedAssets = await api.getBrandAssets(clientId);
      if (version !== loadVersion.current) return;
      setAssets(refreshedAssets.data);
    } catch (err) {
      if (isEditConflict(err)) setConflict(true);
      Alert.alert("Unable to add brand asset", err instanceof Error ? err.message : "Try again.");
    } finally {
      assetBusy.current = false;
      if (version === loadVersion.current) setSaving(false);
    }
  }

  return (
    <PageScroll>
      {conflict && <EditConflict busy={saving} onReload={load} />}
      <PageHeader title={name} subtitle="Brand Brain · Voice, visuals, and publishing rules." />

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Brand asset actions"
          accessibilityState={{ expanded: assetMenuOpen, disabled: !editable }}
          disabled={!editable}
          onPress={() => setAssetMenuOpen((open) => !open)}
          style={styles.assetDropdown}
        >
          <Text style={styles.assetName}>
            {saving ? "Adding asset…" : "Add or choose brand asset"}
          </Text>
          <Ionicons
            name={assetMenuOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.muted}
          />
        </Pressable>
        <Text style={styles.assetRole}>
          Active logo: {brand.logoPreference === "alternate" ? "Alternate" : "Primary"}
        </Text>
        {assetMenuOpen && editable && (
          <View style={styles.assetMenu}>
            {[
              { label: "Upload logo", role: "logo" },
              { label: "Upload alternate logo", role: "alternate_logo" },
              { label: "Add reference image", role: "reference" },
            ].map((item) => (
              <Pressable
                key={item.role}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => void addAsset(item.role as "logo" | "alternate_logo" | "reference")}
                style={styles.assetOption}
              >
                <Text style={styles.assetName}>{item.label}</Text>
              </Pressable>
            ))}
            {["primary", "alternate"].map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`Use ${value} logo`}
                accessibilityState={{ selected: brand.logoPreference === value }}
                onPress={() => {
                  setBrand((current) => ({ ...current, logoPreference: value }));
                  setAssetMenuOpen(false);
                }}
                style={styles.assetOption}
              >
                <Text style={styles.assetName}>Use {value} logo</Text>
                {brand.logoPreference === value && (
                  <Ionicons name="checkmark" size={18} color={colors.primary} />
                )}
              </Pressable>
            ))}
          </View>
        )}
        {!!assets.length && (
          <View style={styles.assetList}>
            {assets.map((asset) => (
              <View key={asset.id} style={styles.assetRow}>
                {["logo", "alternate_logo"].includes(asset.role) ? (
                  <AssetThumbnail
                    assetId={asset.asset_id}
                    label={`${asset.role === "logo" ? "Primary" : "Alternate"} logo preview`}
                  />
                ) : (
                  <Text style={styles.assetName}>{asset.label || asset.filename}</Text>
                )}
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
                            if (
                              !(await confirmAction(
                                "Remove brand asset?",
                                `Remove ${asset.label || asset.filename} from ${name}? Existing original uploads will be retained.`,
                                "Remove asset",
                              ))
                            )
                              return;
                            setSaving(true);
                            try {
                              const removed = await api.removeBrandAsset(
                                clientId,
                                asset.id,
                                revision!,
                              );
                              setRevision(removed.revision);
                              setAssets((await api.getBrandAssets(clientId)).data);
                            } catch (e) {
                              if (isEditConflict(e)) setConflict(true);
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
          subtitle="Logo uploads automatically save up to three distinct colors. Tap a color to adjust it, then save Brand Brain."
        />
        <View style={styles.paletteRow}>
          {["primaryColor", "secondaryColor", "tertiaryColor"].map((key, i) => (
            <View key={key} style={styles.paletteColor}>
              <ColorPicker
                label={["Primary", "Secondary", "Tertiary"][i]}
                value={brand[key] || ""}
                disabled={!editable}
                onChange={(value) => setBrand((current) => ({ ...current, [key]: value }))}
              />
            </View>
          ))}
        </View>
      </Card>

      {[
        {
          title: "Voice & audience",
          keys: ["voice", "audience", "tagline", "website", "preferredCtas"],
          open: true,
        },
        {
          title: "Visual direction",
          keys: ["imageryPreferences", "fonts", "prohibitedVisualStyles", "competitorReferences"],
          open: false,
        },
        {
          title: "Content & publishing rules",
          keys: [
            "postingRules",
            "restrictedWords",
            "brandExamples",
            "brandVocabulary",
            "hashtagPolicy",
            "targetLocations",
            "platformRules",
          ],
          open: false,
        },
      ].map((group) => (
        <EssentialSection key={group.title} title={group.title} defaultOpen={group.open}>
          <View style={styles.grid}>
            {fields
              .filter(([key]) => group.keys.includes(key))
              .map(([key, label, multiline]) => (
                <View key={key} style={[styles.gridItem, multiline && wide && styles.gridItemWide]}>
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
                </View>
              ))}
          </View>
        </EssentialSection>
      ))}

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
  multiline: { minHeight: 96, textAlignVertical: "top" },
  saveWrap: { alignSelf: "stretch" },
  paletteRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  paletteColor: { flexGrow: 1, flexBasis: 120, minWidth: 0 },
  assetDropdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  assetMenu: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  assetOption: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, padding: 12 },
  assetList: { gap: 8 },
  assetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
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

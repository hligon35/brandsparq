import { useCapabilities } from "@/auth/capabilities";
import { Alert } from "@/components/feedback";
import * as ImagePicker from "expo-image-picker";
import { Link, useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { ClientPicker } from "@/components/client-picker";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/api/client";
import { prepareCampaignAsset } from "@/media/prepareUpload";
import { Button, Card, PageHeader, PageScroll, SectionTitle } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";
import type { Client } from "@/types/domain";

const objectives = ["Auto", "Promote", "Awareness", "Announce"];

export default function CreateScreen() {
  const router = useRouter();
  const { clientId: requestedClientId } = useLocalSearchParams<{ clientId?: string }>();
  const can = useCapabilities();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientError, setClientError] = useState("");
  const [objective, setObjective] = useState("Auto");
  const [creationMode, setCreationMode] = useState<"social" | "campaign">("campaign");
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const { wide } = useResponsive();

  async function loadClients() {
    setClientError("");
    try {
      const data = await api.getClients();
      const visible = data.filter((client) => can("generate", client.id));
      setClients(visible);
      setClientId((current) =>
        visible.some((client) => client.id === requestedClientId)
          ? requestedClientId!
          : current || visible[0]?.id || "",
      );
    } catch (err) {
      setClients([]);
      setClientError(err instanceof Error ? err.message : "Unable to load clients.");
    }
  }

  useEffect(() => {
    void loadClients();
  }, [requestedClientId]);

  async function chooseImages() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 20,
      quality: 1,
    });
    if (!result.canceled) setAssets(result.assets);
  }

  async function upload() {
    if (!clientId || !assets.length) return;
    setUploading(true);
    setUploadProgress({ done: 0, total: assets.length });
    try {
      const uploaded = new Array(assets.length);
      let cursor = 0;

      async function worker() {
        while (true) {
          const index = cursor++;
          if (index >= assets.length) return;
          const asset = assets[index];
          const prepared = await prepareCampaignAsset(asset, index);
          const original = await api.uploadAsset(
            clientId,
            asset.uri,
            asset.fileName || `brandsparq-${Date.now()}-${index + 1}.jpg`,
            asset.mimeType || "image/jpeg",
            asset.width,
            asset.height,
          );
          await api.uploadAssetDerivative(
            clientId,
            original.id,
            prepared.analysisUri,
            "analysis",
            prepared.analysisFilename,
            prepared.analysisMimeType,
            prepared.analysisWidth,
            prepared.analysisHeight,
          );
          uploaded[index] = original;
          setUploadProgress((progress) => ({
            ...progress,
            done: progress.done + 1,
          }));
        }
      }

      await Promise.all(Array.from({ length: Math.min(3, assets.length) }, () => worker()));

      const job = await api.createGenerationJob(
        clientId,
        objective,
        uploaded.map((item) => item.id),
      );
      setAssets([]);
      setUploadProgress({ done: 0, total: 0 });
      router.push(`/generation?jobId=${job.jobId}`);
    } catch (error) {
      Alert.alert(
        "Campaign creation failed",
        error instanceof Error ? error.message : "Unable to create campaign.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <PageScroll>
      <PageHeader eyebrow="Create" title="What are we making?" subtitle="Turn your ideas into content." />
      <View style={styles.modeRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Create a social post"
          accessibilityState={{ selected: creationMode === "social" }}
          onPress={() => { setCreationMode("social"); setObjective("Auto"); }}
          style={[styles.modeCard, creationMode === "social" && styles.modeCardSelected]}>
          <Ionicons name="image-outline" size={30} color={colors.primary} />
          <Text style={styles.modeTitle}>Social post</Text>
          <Text style={styles.modeDescription}>Image + caption</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Create a campaign"
          accessibilityState={{ selected: creationMode === "campaign" }}
          onPress={() => setCreationMode("campaign")}
          style={[styles.modeCard, creationMode === "campaign" && styles.modeCardSelected]}>
          <Ionicons name="sparkles-outline" size={30} color={colors.primary} />
          <Text style={styles.modeTitle}>Campaign</Text>
          <Text style={styles.modeDescription}>Plan a series</Text>
        </Pressable>
      </View>

      {clientError ? (
        <Card subtle>
          <Text style={styles.errorTitle}>Clients unavailable</Text>
          <Text style={styles.errorBody}>{clientError}</Text>
          <Pressable onPress={loadClients}>
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </Card>
      ) : !clients.length ? (
        <Card subtle>
          <Text style={styles.errorTitle}>Add your first client</Text>
          <Text style={styles.errorBody}>
            BrandSparQ needs a client and Brand Brain before it can generate a campaign.
          </Text>
          <Link href="/clients" asChild>
            <Pressable>
              <Text style={styles.retry}>Open Clients & Brand Brain →</Text>
            </Pressable>
          </Link>
        </Card>
      ) : (
        <View style={[styles.columns, wide && styles.columnsWide]}>
          <View style={styles.column}>
            <Card>
              <SectionTitle
                title="1. Choose client"
                subtitle="Brand Brain rules will shape the creative."
              />
              <ClientPicker clients={clients} value={clientId} onChange={setClientId} />
            </Card>
            <Card>
              <SectionTitle
                title={creationMode === "social" ? "2. Social post goal" : "2. Campaign objective"}
                subtitle="Or leave it on Auto and let BrandSparQ decide."
              />
              <View style={styles.chips}>
                {objectives.map((item) => {
                  const active = item === objective;
                  return (
                    <Pressable
                      key={item}
                      onPress={() => setObjective(item)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{item}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          </View>
          <View style={styles.column}>
            <Card style={styles.assetCard}>
              <SectionTitle
                title="3. Start with a photo"
                subtitle="Select up to 20 images from your phone, tablet, or browser."
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={assets.length ? "Change images" : "Choose images"}
                disabled={uploading}
                onPress={chooseImages}
                style={styles.uploadTarget}
              >
                <Ionicons name="images-outline" size={36} color={colors.primary} />
                <Text style={styles.uploadTitle}>
                  {assets.length ? "Change images" : "Start with a photo"}
                </Text>
                <Text style={styles.errorBody}>Choose up to 20 brand images</Text>
              </Pressable>
              {!!assets.length && (
                <View style={styles.previewGrid}>
                  {assets.map((asset) => (
                    <Image
                      key={asset.assetId || asset.uri}
                      source={{ uri: asset.uri }}
                      style={styles.preview}
                    />
                  ))}
                </View>
              )}
              {!!assets.length && uploading && (
                <Text style={styles.progress}>
                  Preparing and uploading {uploadProgress.done} of {uploadProgress.total}…
                </Text>
              )}
              {!!assets.length && (
                <Button
                  label={
                    uploading
                      ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
                      : `Create campaign from ${assets.length} image${assets.length === 1 ? "" : "s"}`
                  }
                  onPress={uploading ? undefined : upload}
                />
              )}
            </Card>
          </View>
        </View>
      )}
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  modeCard: { flexGrow: 1, flexBasis: 135, minWidth: 0, minHeight: 152, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: 8, alignItems: "flex-start" },
  modeCardSelected: { borderColor: colors.primary, backgroundColor: colors.surface2 },
  modeTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  modeDescription: { color: colors.muted, fontSize: 13 },
  uploadTarget: {
    padding: 24,
    minHeight: 170,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.primary,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  uploadTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  columns: { gap: spacing.md },
  columnsWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1, gap: spacing.md, minWidth: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    minHeight: 44,
    paddingVertical: 11,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSoft, fontWeight: "700" },
  chipTextActive: { color: colors.white },
  assetCard: { minHeight: 290 },
  previewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  preview: { width: 104, height: 132, borderRadius: radius.md, backgroundColor: colors.surface2 },
  errorTitle: { color: colors.text, fontSize: 20, fontWeight: "900" },
  errorBody: { color: colors.muted, lineHeight: 21 },
  retry: { color: colors.primary, fontWeight: "800" },
  progress: { color: colors.textSoft, fontWeight: "700" },
});

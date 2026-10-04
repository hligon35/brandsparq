import * as ImagePicker from "expo-image-picker";
import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { prepareCampaignAsset } from "@/media/prepareUpload";
import { Button, Card, PageHeader, PageScroll, SectionTitle } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";
import type { Client } from "@/types/domain";

const objectives = ["Auto", "Promote", "Awareness", "Announce"];

export default function CreateScreen() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientError, setClientError] = useState("");
  const [objective, setObjective] = useState("Auto");
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const { wide } = useResponsive();

  async function loadClients() {
    setClientError("");
    try {
      const data = await api.getClients();
      setClients(data);
      setClientId((current) => current || data[0]?.id || "");
    } catch (err) {
      setClients([]);
      setClientError(err instanceof Error ? err.message : "Unable to load clients.");
    }
  }

  useEffect(() => {
    void loadClients();
  }, []);

  const selectedClient = useMemo(() => clients.find((c) => c.id === clientId), [clientId, clients]);

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
      Alert.alert(
        "Campaign generation started",
        `${uploaded.length} image${uploaded.length === 1 ? "" : "s"} uploaded for ${selectedClient?.name ?? "this client"}. Job ${job.jobId.slice(0, 8)} is queued.`,
      );
      setAssets([]);
      setUploadProgress({ done: 0, total: 0 });
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
      <PageHeader
        eyebrow="Create"
        title="Turn images into a campaign"
        subtitle="Choose the brand and objective, add your raw images, and let BrandSparQ build platform-ready creative and captions."
      />

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
              <View style={styles.chips}>
                {clients.map((client) => {
                  const active = client.id === clientId;
                  return (
                    <Pressable
                      key={client.id}
                      onPress={() => setClientId(client.id)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {client.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
            <Card>
              <SectionTitle
                title="2. Set objective"
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
                title="3. Add source images"
                subtitle="Select up to 20 images from your phone, tablet, or browser."
              />
              <Button
                label={assets.length ? "Change images" : "Choose images"}
                onPress={chooseImages}
                secondary={!!assets.length}
              />
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
    paddingVertical: 10,
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

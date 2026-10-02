import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api } from "@/api/client";
import { Button, Card, Screen } from "@/components/ui";
import { clients as demoClients } from "@/data/demo";
import { colors, radius, spacing } from "@/theme/tokens";
import type { Client } from "@/types/domain";

const objectives = ["Auto", "Promote", "Awareness", "Announce"];

export default function CreateScreen() {
  const [clients, setClients] = useState<Client[]>(demoClients);
  const [clientId, setClientId] = useState(demoClients[0]?.id ?? "");
  const [objective, setObjective] = useState("Auto");
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    api.getClients()
      .then((data) => {
        if (!data.length) return;
        setClients(data);
        setClientId((current) => current || data[0].id);
      })
      .catch(() => {});
  }, []);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === clientId),
    [clientId, clients]
  );

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
    try {
      const uploaded = [];
      for (const [index, asset] of assets.entries()) {
        uploaded.push(
          await api.uploadAsset(
            clientId,
            asset.uri,
            asset.fileName || `brandsparq-${Date.now()}-${index + 1}.jpg`,
            asset.mimeType || "image/jpeg"
          )
        );
      }
      Alert.alert(
        "Uploaded",
        `${uploaded.length} image${uploaded.length === 1 ? "" : "s"} added for ${selectedClient?.name ?? "this client"}. The AI generation queue connects next.`
      );
      setAssets([]);
    } catch (error) {
      Alert.alert(
        "Upload failed",
        error instanceof Error ? error.message : "Unable to upload images."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>CREATE</Text>
        <Text style={styles.title}>Turn images into a campaign</Text>
        <Text style={styles.sub}>
          Choose the client, add raw images, then BrandSparQ can analyze and build platform-ready content.
        </Text>

        <Card>
          <Text style={styles.label}>Client</Text>
          <View style={styles.chips}>
            {clients.map((client) => (
              <Text
                key={client.id}
                onPress={() => setClientId(client.id)}
                style={[
                  styles.chip,
                  client.id === clientId && styles.chipActive,
                ]}
              >
                {client.name}
              </Text>
            ))}
          </View>
        </Card>

        <Card>
          <Text style={styles.label}>Objective</Text>
          <View style={styles.chips}>
            {objectives.map((item) => (
              <Text
                key={item}
                onPress={() => setObjective(item)}
                style={[styles.chip, item === objective && styles.chipActive]}
              >
                {item}
              </Text>
            ))}
          </View>
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Source images</Text>
          <Text style={styles.sub}>
            Select up to 20 images from your phone, tablet, or browser.
          </Text>
          <Button label={assets.length ? "Change images" : "Choose images"} onPress={chooseImages} />
          {!!assets.length && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.previewRow}>
                {assets.map((asset) => (
                  <Image
                    key={asset.assetId || asset.uri}
                    source={{ uri: asset.uri }}
                    style={styles.preview}
                  />
                ))}
              </View>
            </ScrollView>
          )}
          {!!assets.length && (
            <Button
              label={uploading ? "Uploading…" : `Upload ${assets.length} image${assets.length === 1 ? "" : "s"}`}
              onPress={uploading ? undefined : upload}
            />
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: 40 },
  eyebrow: { color: colors.accent, fontWeight: "800", letterSpacing: 2 },
  title: { color: colors.text, fontSize: 30, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    overflow: "hidden",
  },
  chipActive: { backgroundColor: colors.accent },
  previewRow: { flexDirection: "row", gap: 10 },
  preview: { width: 110, height: 138, borderRadius: radius.md, backgroundColor: colors.surface2 },
});

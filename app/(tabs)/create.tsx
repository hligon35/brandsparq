import { readDraft, saveDraft } from "@/shared/draft-storage";
import { useAuth } from "@/auth/context";
import { GuardedLink as Link, useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { uploadBatch, type UploadItem } from "@/shared/upload-batch";
import { Choices } from "@/components/forms";
import { useCapabilities } from "@/auth/capabilities";
import { Alert, confirmAction } from "@/components/feedback";
import * as ImagePicker from "expo-image-picker";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
  const { user } = useAuth();
  const draftKey = `brandsparq_create_${user?.id || "anonymous"}`;
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  const { clientId: requestedClientId } = useLocalSearchParams<{ clientId?: string }>();
  const can = useCapabilities();
  const [clients, setClients] = useState<Client[]>([]),
    [clientId, setClientId] = useState(""),
    [clientError, setClientError] = useState("");
  const [objective, setObjective] = useState("Auto"),
    [creationMode, setCreationMode] = useState<"social" | "campaign">("campaign"),
    [outputCount, setOutputCount] = useState(3);
  const [items, setItems] = useState<UploadItem<ImagePicker.ImagePickerAsset>[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [uploading, setUploading] = useState(false),
    [readiness, setReadiness] = useState<any>(),
    [readinessError, setReadinessError] = useState("");
  const [destinationIds, setDestinationIds] = useState<string[]>([]);
  const pending = useRef<Parameters<typeof api.createContent>[0] | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const operation = useRef(0);
  const submitting = useRef(false),
    loadVersion = useRef(0);
  const [pendingCreation, setPendingCreation] = useState(false);
  const { wide } = useResponsive();
  const assets = items.map((item) => item.source);
  const uploadProgress = {
    done: items.filter((item) => item.status === "ready").length,
    total: items.length,
  };
  const draft = {
    clientId,
    objective,
    creationMode,
    outputCount,
    destinationIds,
    images: items.map((item) => item.key),
  };
  const { markSaved } = useUnsavedChanges(
    draft,
    draftLoaded &&
      (!!items.length ||
        pendingCreation ||
        uploading ||
        objective !== "Auto" ||
        !!destinationIds.length ||
        creationMode !== "campaign" ||
        outputCount !== 3),
    () => {
      operation.current++;
      pending.current = null;
      setPendingCreation(false);
      setItems([]);
      void saveDraft(draftKey, null).catch(() => undefined);
    },
  );
  function storedItems(values: typeof items) {
    return values.map((item) => ({
      ...item,
      source: {
        uri: Platform.OS === "web" ? "" : item.source.uri,
        width: item.source.width,
        height: item.source.height,
        fileName: item.source.fileName,
        mimeType: item.source.mimeType,
      },
    }));
  }
  const locked = !draftLoaded || uploading || pendingCreation;
  useEffect(() => {
    let active = true;
    void readDraft<any>(draftKey)
      .then((saved) => {
        if (!active) return;
        if (saved) {
          setClientId(saved.clientId || "");
          setObjective(saved.objective || "Auto");
          setCreationMode(saved.creationMode === "social" ? "social" : "campaign");
          setOutputCount([3, 4, 5].includes(saved.outputCount) ? saved.outputCount : 3);
          setDestinationIds(saved.destinationIds || []);
          // Uploaded images can be reused. Browser blob URLs do not survive a reload.
          const restored = (saved.items || []).filter(
            (item: any) => Platform.OS !== "web" || (item.status === "ready" && item.originalId),
          );
          setItems(restored);
          pending.current = saved.pending || null;
          setPendingCreation(!!saved.pending);
          setDraftNotice(
            saved.pending
              ? "Recovered an unconfirmed request. Retry uses the same request identity."
              : "Draft restored. Reattach any photos that were not fully uploaded before leaving.",
          );
        }
        markSaved({ ...draft, images: [] });
        setDraftLoaded(true);
      })
      .catch(() => {
        if (active) {
          setDraftNotice("Saved draft could not be restored. Your workspace content is unchanged.");
          setDraftLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [draftKey]);
  useEffect(() => {
    if (!draftLoaded || uploading || pendingCreation) return;
    const timer = setTimeout(() => {
      void saveDraft(draftKey, {
        clientId,
        objective,
        creationMode,
        outputCount,
        destinationIds,
        items: storedItems(items),
        pending: pending.current,
      }).catch(() =>
        setDraftNotice(
          "This draft could not be saved on this device. Keep this screen open until submission completes.",
        ),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [
    draftLoaded,
    clientId,
    objective,
    creationMode,
    outputCount,
    JSON.stringify(destinationIds),
    JSON.stringify(items),
    uploading,
    pendingCreation,
  ]);
  async function loadClients() {
    setClientError("");
    try {
      const rows = (await api.getClients()).filter((c) => can("generate", c.id));
      setClients(rows);
      setClientId((current) =>
        rows.some((c) => c.id === requestedClientId)
          ? requestedClientId!
          : current || rows[0]?.id || "",
      );
    } catch (error) {
      setClientError(error instanceof Error ? error.message : "Unable to load clients.");
    }
  }
  useEffect(() => {
    void loadClients();
  }, [requestedClientId]);
  async function loadReadiness() {
    const version = ++loadVersion.current;
    setReadiness(undefined);
    setReadinessError("");
    if (!clientId) return;
    try {
      const next = (await api.getCreationReadiness(clientId)).data;
      if (version !== loadVersion.current) return;
      setReadiness(next);
      setDestinationIds((current) =>
        pending.current
          ? current
          : current.filter((id) => next.destinations.some((d: any) => d.id === id && d.ready)),
      );
    } catch (error) {
      if (version === loadVersion.current)
        setReadinessError(error instanceof Error ? error.message : "Unable to check readiness.");
    }
  }
  useEffect(() => {
    void loadReadiness();
    return () => {
      loadVersion.current++;
    };
  }, [clientId]);
  async function changeClient(id: string) {
    if (locked || id === clientId) return;
    if (
      items.length &&
      !(await confirmAction(
        "Change client?",
        "The selected images will be uploaded for the new client. Completed uploads remain with the previous client.",
        "Change client",
      ))
    )
      return;
    setItems((current) =>
      current
        .filter((item) => !!item.source.uri)
        .map((item) => ({
          ...item,
          originalId: undefined,
          status: "pending",
          error: undefined,
        })),
    );
    setDestinationIds([]);
    setClientId(id);
  }
  function toggleDestination(account: any) {
    if (locked) return;
    setDestinationIds((current) => {
      if (current.includes(account.id)) return current.filter((id) => id !== account.id);
      const next =
        creationMode === "social"
          ? []
          : current.filter(
              (id) =>
                readiness.destinations.find((d: any) => d.id === id)?.platform !== account.platform,
            );
      return [...next, account.id].slice(0, creationMode === "social" ? 1 : outputCount);
    });
  }
  async function chooseImages() {
    if (locked) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 20,
        quality: 1,
      });
      if (!result.canceled)
        setItems((current) =>
          [
            ...current,
            ...result.assets
              .filter((asset) => !current.some((item) => item.key === asset.uri))
              .map((source) => ({ key: source.uri, source, status: "pending" as const })),
          ].slice(0, 20),
        );
    } catch (error) {
      Alert.alert("Unable to open photos", error instanceof Error ? error.message : "Try again.");
    }
  }
  async function upload() {
    if (!clientId || (!items.length && !pending.current) || submitting.current) return;
    submitting.current = true;
    const currentOperation = ++operation.current;
    setUploading(true);
    const snapshot = itemsRef.current,
      selectedClient = clientId;
    const changed = () => {
      if (alive.current && currentOperation === operation.current) setItems([...snapshot]);
    };
    try {
      if (!pending.current) {
        const ready = (await api.getCreationReadiness(selectedClient)).data;
        if (
          !ready.ready ||
          !destinationIds.length ||
          destinationIds.some((id) => !ready.destinations.some((d: any) => d.id === id && d.ready))
        )
          throw new Error(ready.blockers.join(" ") || "Choose a ready publishing destination.");
        await uploadBatch(
          snapshot,
          async (item, index) => {
            if (!item.originalId) {
              const original = await api.uploadAsset(
                selectedClient,
                item.source.uri,
                item.source.fileName || `brandsparq-${Date.now()}-${index}.jpg`,
                item.source.mimeType || "image/jpeg",
                item.source.width,
                item.source.height,
              );
              item.originalId = original.id;
              changed();
            }
            const prepared = await prepareCampaignAsset(item.source, index);
            await api.uploadAssetDerivative(
              selectedClient,
              item.originalId!,
              prepared.analysisUri,
              "analysis",
              prepared.analysisFilename,
              prepared.analysisMimeType,
              prepared.analysisWidth,
              prepared.analysisHeight,
            );
          },
          changed,
        );
        if (!alive.current || currentOperation !== operation.current) return;
        pending.current = {
          clientId: selectedClient,
          objective,
          assetIds: [...new Set(snapshot.map((item) => item.originalId!))],
          mode: creationMode,
          outputCount: creationMode === "social" ? 1 : outputCount,
          destinationIds: [...destinationIds],
          requestKey: `creation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`,
        };
      }
      if (!alive.current || currentOperation !== operation.current) return;
      await saveDraft(draftKey, {
        clientId: pending.current.clientId,
        objective: pending.current.objective,
        creationMode: pending.current.mode,
        outputCount: pending.current.outputCount,
        destinationIds: pending.current.destinationIds,
        items: storedItems(snapshot),
        pending: pending.current,
      });
      if (!alive.current || currentOperation !== operation.current) return;
      const job = await api.createContent(pending.current);
      if (!alive.current || currentOperation !== operation.current) return;
      pending.current = null;
      await saveDraft(draftKey, null).catch(() => undefined);
      setPendingCreation(false);
      setItems([]);
      markSaved({ ...draft, images: [] });
      router.push(`/generation?jobId=${job.jobId}`);
    } catch (error) {
      if (!alive.current || currentOperation !== operation.current) return;
      const status = (error as { status?: number })?.status;
      if (status && status >= 400 && status < 500 && status !== 408) pending.current = null;
      setPendingCreation(!!pending.current);
      await saveDraft(draftKey, {
        clientId,
        objective,
        creationMode,
        outputCount,
        destinationIds,
        items: storedItems(snapshot),
        pending: pending.current,
      }).catch(() => undefined);
      Alert.alert(
        "Content creation needs attention",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      submitting.current = false;
      setUploading(false);
    }
  }
  return (
    <PageScroll>
      <PageHeader
        eyebrow="Create"
        title="What are we making?"
        subtitle="Turn your ideas into content."
      />
      {!!draftNotice && (
        <Card subtle>
          <Text>{draftNotice}</Text>
        </Card>
      )}
      <View style={styles.modeRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a social post"
          accessibilityState={{ selected: creationMode === "social" }}
          disabled={locked}
          onPress={() => {
            setDestinationIds((current) => current.slice(0, 1));
            setCreationMode("social");
            setObjective("Auto");
          }}
          style={[styles.modeCard, creationMode === "social" && styles.modeCardSelected]}
        >
          <Ionicons name="image-outline" size={30} color={colors.primary} />
          <Text style={styles.modeTitle}>Social post</Text>
          <Text style={styles.modeDescription}>Image + caption</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a campaign"
          accessibilityState={{ selected: creationMode === "campaign" }}
          disabled={locked}
          onPress={() => setCreationMode("campaign")}
          style={[styles.modeCard, creationMode === "campaign" && styles.modeCardSelected]}
        >
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
          <View style={[styles.column, wide && { flex: 1 }]}>
            <Card>
              <SectionTitle
                title="1. Choose client"
                subtitle="Brand Brain rules will shape the creative."
              />
              <ClientPicker
                clients={clients}
                value={clientId}
                onChange={changeClient}
                disabled={locked}
              />
            </Card>
            <Card>
              <SectionTitle
                title="Publishing destinations"
                subtitle="Choose one account per platform. Every selected platform receives at least one post."
              />
              {readinessError ? (
                <>
                  <Text style={styles.errorBody}>{readinessError}</Text>
                  <Button label="Retry readiness check" onPress={loadReadiness} />
                </>
              ) : !readiness ? (
                <Text style={styles.errorBody}>Checking readiness…</Text>
              ) : (
                <>
                  {readiness.blockers.map((text: string) => (
                    <Text key={text} style={styles.errorBody}>
                      {text}
                    </Text>
                  ))}
                  {readiness.warnings.map((text: string) => (
                    <Text key={text} style={styles.errorBody}>
                      {text}
                    </Text>
                  ))}
                  {readiness.destinations.map((account: any) => (
                    <Button
                      key={account.id}
                      label={`${destinationIds.includes(account.id) ? "✓ " : ""}${account.platform} · ${account.account_name || account.id}${account.is_default ? " · default" : ""}${!account.ready ? " · needs attention" : ""}`}
                      secondary={!destinationIds.includes(account.id)}
                      onPress={
                        locked || !account.ready ? undefined : () => toggleDestination(account)
                      }
                    />
                  ))}
                  <Link href={`/clients/${clientId}/brand`} asChild>
                    <Button label="Open Brand Brain" small secondary />
                  </Link>
                  <Link href={`/social?clientId=${clientId}`} asChild>
                    <Button label="Manage destinations" small secondary />
                  </Link>
                  <Button
                    label="Refresh readiness"
                    small
                    secondary
                    onPress={locked ? undefined : loadReadiness}
                  />
                </>
              )}
              {creationMode === "campaign" && (
                <>
                  <Text style={styles.errorBody}>Number of posts</Text>
                  <Choices
                    values={["3", "4", "5"]}
                    value={String(outputCount)}
                    disabled={locked}
                    onChange={(value) => {
                      setOutputCount(Number(value));
                      setDestinationIds((current) => current.slice(0, Number(value)));
                    }}
                  />
                </>
              )}
            </Card>
            <Card>
              <SectionTitle
                title={creationMode === "social" ? "2. Social post goal" : "2. Campaign objective"}
                subtitle="Or leave it on Auto and let BrandSparQ decide."
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.chips}
              >
                {objectives.map((item) => {
                  const active = item === objective;
                  return (
                    <Pressable
                      key={item}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      disabled={locked}
                      onPress={() => setObjective(item)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.chipText, active && styles.chipTextActive]}
                      >
                        {item}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Card>
          </View>
          <View style={[styles.column, wide && { flex: 1 }]}>
            <Card style={styles.assetCard}>
              <SectionTitle
                title="3. Start with a photo"
                subtitle="Select up to 20 images from your phone, tablet, or browser."
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={assets.length ? "Add images" : "Choose images"}
                disabled={locked}
                onPress={chooseImages}
                style={styles.uploadTarget}
              >
                <Ionicons name="images-outline" size={36} color={colors.primary} />
                <Text style={styles.uploadTitle}>
                  {assets.length ? "Add images" : "Start with a photo"}
                </Text>
                <Text style={styles.errorBody}>Choose up to 20 brand images</Text>
              </Pressable>
              {!!assets.length && (
                <View style={styles.previewGrid}>
                  {items.map((item) => (
                    <View key={item.key} style={{ gap: 6 }}>
                      {(item.source.uri && Platform.OS !== "web") ||
                      (Platform.OS === "web" && !item.originalId) ? (
                        <Image source={{ uri: item.source.uri }} style={styles.preview} />
                      ) : (
                        <Text style={styles.errorBody}>
                          {item.source.fileName || "Uploaded image"}
                        </Text>
                      )}
                      <Text style={styles.errorBody}>{item.status}</Text>
                      {!!item.error && (
                        <Text style={[styles.errorBody, { maxWidth: 180 }]}>{item.error}</Text>
                      )}
                      <Button
                        label={`Remove ${item.source.fileName || "image"}`}
                        small
                        secondary
                        onPress={
                          locked
                            ? undefined
                            : () =>
                                setItems((current) =>
                                  current.filter((entry) => entry.key !== item.key),
                                )
                        }
                      />
                    </View>
                  ))}
                </View>
              )}
              {!!assets.length && uploading && (
                <Text style={styles.progress}>
                  Preparing and uploading {uploadProgress.done} of {uploadProgress.total}…
                </Text>
              )}
              {(!!assets.length || pendingCreation) && (
                <Button
                  label={
                    uploading
                      ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
                      : pendingCreation
                        ? "Retry creation request"
                        : items.some((item) => item.status === "failed")
                          ? "Retry failed uploads"
                          : creationMode === "social"
                            ? "Create social post"
                            : `Create ${outputCount}-post campaign`
                  }
                  onPress={
                    uploading || (!pendingCreation && (!readiness?.ready || !destinationIds.length))
                      ? undefined
                      : upload
                  }
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
  modeCard: {
    flexGrow: 1,
    flexBasis: 135,
    minWidth: 0,
    minHeight: 152,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 8,
    alignItems: "flex-start",
  },
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
  column: { gap: spacing.md, minWidth: 0 },
  chips: { flexDirection: "row", gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    flexShrink: 0,
    alignItems: "center",
    paddingHorizontal: spacing.md,
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

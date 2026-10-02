import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "@/api/client";
import {
  Button,
  Card,
  PageHeader,
  PageScroll,
  SectionTitle,
} from "@/components/ui";
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
] as const;

export default function BrandBrainScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const [brand, setBrand] = useState<Record<string, string>>({});
  const [name, setName] = useState("Brand Brain");
  const [saving, setSaving] = useState(false);
  const { wide } = useResponsive();

  useEffect(() => {
    if (!clientId) return;
    api
      .getBrand(clientId)
      .then(({ data }) => {
        setName(data.name || "Brand Brain");
        setBrand({
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
        });
      })
      .catch(() => {});
  }, [clientId]);

  async function save() {
    if (!clientId) return;
    setSaving(true);
    try {
      await api.saveBrand(clientId, brand);
      Alert.alert(
        "Brand Brain saved",
        "Future generations will use these rules."
      );
    } catch (error) {
      Alert.alert(
        "Unable to save",
        error instanceof Error ? error.message : "Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageScroll>
      <PageHeader
        eyebrow="Client intelligence"
        title={name}
        subtitle="These rules shape the creative direction, captions, CTAs, and scheduling recommendations BrandSparQ generates."
      />

      <Card>
        <SectionTitle
          title="Brand colors"
          subtitle="Use hex values to keep generated creative aligned."
        />
        <View style={[styles.colorRow, wide && styles.colorRowWide]}>
          <View style={styles.colorField}>
            <Text style={styles.label}>Primary</Text>
            <TextInput
              style={styles.input}
              value={brand.primaryColor || ""}
              onChangeText={(value) =>
                setBrand({ ...brand, primaryColor: value })
              }
              placeholder="#0B78F6"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={styles.colorField}>
            <Text style={styles.label}>Secondary</Text>
            <TextInput
              style={styles.input}
              value={brand.secondaryColor || ""}
              onChangeText={(value) =>
                setBrand({ ...brand, secondaryColor: value })
              }
              placeholder="#00C9D7"
              placeholderTextColor={colors.muted}
            />
          </View>
        </View>
      </Card>

      <View style={styles.grid}>
        {fields.map(([key, label, multiline]) => (
          <View
            key={key}
            style={[
              styles.gridItem,
              multiline && wide && styles.gridItemWide,
            ]}
          >
            <Card style={styles.fieldCard}>
              <Text style={styles.label}>{label}</Text>
              <TextInput
                style={[styles.input, multiline && styles.multiline]}
                value={brand[key] || ""}
                onChangeText={(value) =>
                  setBrand({ ...brand, [key]: value })
                }
                placeholder={label}
                placeholderTextColor={colors.muted}
                multiline={multiline}
              />
            </Card>
          </View>
        ))}
      </View>

      <View style={styles.saveWrap}>
        <Button
          label={saving ? "Saving…" : "Save Brand Brain"}
          onPress={saving ? undefined : save}
        />
      </View>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  colorRow: {
    gap: spacing.md,
  },
  colorRowWide: {
    flexDirection: "row",
  },
  colorField: {
    flex: 1,
    gap: 7,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  gridItem: {
    flexGrow: 1,
    flexBasis: 330,
    maxWidth: "100%",
  },
  gridItemWide: {
    flexBasis: 520,
  },
  fieldCard: {
    height: "100%",
  },
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
  multiline: {
    minHeight: 118,
    textAlignVertical: "top",
  },
  saveWrap: {
    alignSelf: "flex-end",
    minWidth: 220,
  },
});

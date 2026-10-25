import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "./ui";
import { colors, radius, spacing } from "@/theme/tokens";
export function Field({
  label,
  value,
  onChange,
  multiline = false,
  editable = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        editable={editable}
        style={[styles.input, multiline && { minHeight: 100 }]}
      />
    </View>
  );
}
export function Choices({
  values,
  value,
  onChange,
  disabled = false,
  singleRow = false,
}: {
  values: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  singleRow?: boolean;
}) {
  if (singleRow)
    return (
      <View style={{ flexDirection: "row", gap: 4 }}>
        {values.map((v) => (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityState={{ selected: v === value, disabled }}
            disabled={disabled}
            onPress={() => onChange(v)}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 44,
              padding: 4,
              borderRadius: 12,
              backgroundColor: v === value ? colors.primary : colors.surface2,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "700",
                color: v === value ? colors.white : colors.text,
              }}
            >
              {v}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  return (
    <View style={styles.row}>
      {values.map((v) => (
        <Button
          key={v}
          small
          secondary={v !== value}
          label={v}
          onPress={disabled ? undefined : () => onChange(v)}
        />
      ))}
    </View>
  );
}
export const formStyles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  text: { color: colors.textSoft, lineHeight: 22 },
  error: { color: colors.warning, lineHeight: 22 },
});
const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { color: colors.text, fontWeight: "800" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface2,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});

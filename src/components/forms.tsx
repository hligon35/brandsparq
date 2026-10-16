import { StyleSheet, Text, TextInput, View } from "react-native";
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
}: {
  values: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
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

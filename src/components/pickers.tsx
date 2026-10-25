import { useState } from "react";
import {
  FlatList,
  Modal,
  ScrollView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "./ui";
import { colors } from "@/theme/tokens";
import { TIMEZONES } from "@/shared/timezones";
export function SelectField({
  label,
  value,
  values,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={styles.input}
      >
        <Text style={styles.text}>{value || "Choose…"} ▾</Text>
      </Pressable>
      <Modal visible={open} transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.dialog}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
              accessibilityLabel={`Search ${label}`}
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Search…"
            />
            <FlatList
              style={{ maxHeight: 360 }}
              keyboardShouldPersistTaps="handled"
              data={[...new Set([value, ...values].filter(Boolean))].filter((v) =>
                v.toLowerCase().includes(query.toLowerCase()),
              )}
              keyExtractor={(v) => v}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: item === value }}
                  style={styles.input}
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                >
                  <Text style={styles.text}>{item}</Text>
                </Pressable>
              )}
            />
            <Button label="Cancel" secondary onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
export function TimezonePicker(props: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return <SelectField label="Timezone" values={TIMEZONES} {...props} />;
}
export function TimePicker({
  label = "Time",
  value,
  onChange,
  disabled = false,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value || "09:00");
  const [hour, minute] = draft.split(":");
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        disabled={disabled}
        style={styles.input}
        onPress={() => {
          setDraft(value || "09:00");
          setOpen(true);
        }}
      >
        <Text style={styles.text}>{value || "Choose time"} ◷</Text>
      </Pressable>
      <Modal visible={open} transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.dialog}>
            <Text style={styles.label}>{label} · 24-hour time</Text>
            <View style={styles.row}>
              {[
                { label: "Hour", count: 24, current: hour },
                { label: "Minute", count: 60, current: minute },
              ].map((column, index) => (
                <View key={column.label} style={{ flex: 1, gap: 8 }}>
                  <Text style={styles.label}>{column.label}</Text>
                  <FlatList
                    style={{ height: 230 }}
                    initialScrollIndex={Math.max(0, Number(column.current) || 0)}
                    getItemLayout={(_, i) => ({ length: 48, offset: 48 * i, index: i })}
                    data={Array.from({ length: column.count }, (_, i) =>
                      String(i).padStart(2, "0"),
                    )}
                    keyExtractor={(v) => v}
                    renderItem={({ item }) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${column.label} ${item}`}
                        accessibilityState={{ selected: item === column.current }}
                        style={[
                          styles.timeOption,
                          item === column.current && { backgroundColor: colors.bgStrong },
                        ]}
                        onPress={() =>
                          setDraft(index === 0 ? `${item}:${minute}` : `${hour}:${item}`)
                        }
                      >
                        <Text style={styles.text}>{item}</Text>
                      </Pressable>
                    )}
                  />
                </View>
              ))}
            </View>
            <Button
              label="Use time"
              onPress={() => {
                onChange(draft);
                setOpen(false);
              }}
            />
            <Button label="Cancel" secondary onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
export function TimeWindows({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {values.map((window, i) => {
        const [start, end] = window.split("-");
        return (
          <View key={i} style={styles.row}>
            <View style={{ flex: 1 }}>
              <TimePicker
                label="From"
                value={start}
                onChange={(v) => onChange(values.map((x, j) => (i === j ? `${v}-${end}` : x)))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <TimePicker
                label="Until"
                value={end}
                onChange={(v) => onChange(values.map((x, j) => (i === j ? `${start}-${v}` : x)))}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${label} ${i + 1}`}
              onPress={() => onChange(values.filter((_, j) => i !== j))}
              style={{ minWidth: 44, minHeight: 48, justifyContent: "center" }}
            >
              <Text style={styles.text}>×</Text>
            </Pressable>
          </View>
        );
      })}
      <Button
        label={`Add ${label.toLowerCase()}`}
        small
        secondary
        onPress={() => onChange([...values, "09:00-17:00"])}
      />
    </View>
  );
}
export function ColorPicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value || "#0B78F6");
  const valid = /^#[0-9a-f]{6}$/i.test(draft);
  const rgb = valid ? [1, 3, 5].map((i) => Number.parseInt(draft.slice(i, i + 2), 16)) : [0, 0, 0];
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} color`}
        disabled={disabled}
        onPress={() => {
          setDraft(value || "#0B78F6");
          setOpen(true);
        }}
        style={[
          styles.input,
          {
            borderLeftWidth: 12,
            borderLeftColor: /^#[0-9a-f]{6}$/i.test(value) ? value : colors.primary,
          },
        ]}
      >
        <Text style={styles.text}>{value || "Choose color"}</Text>
      </Pressable>
      <Modal visible={open} transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.dialog}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
              <Text style={styles.label}>{label} color</Text>
              <View
                style={{
                  height: 60,
                  backgroundColor: valid ? draft : colors.surface2,
                  borderRadius: 12,
                }}
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {[
                  "#000000",
                  "#FFFFFF",
                  "#E45261",
                  "#FF8A00",
                  "#FFBD00",
                  "#0DAF7A",
                  "#08C2B1",
                  "#00C9D7",
                  "#0B78F6",
                  "#071A5D",
                  "#9A4DF4",
                  "#E84BA3",
                ].map((color) => (
                  <Pressable
                    key={color}
                    accessibilityRole="button"
                    accessibilityLabel={color}
                    onPress={() => setDraft(color)}
                    style={{
                      width: 44,
                      height: 44,
                      backgroundColor: color,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 8,
                    }}
                  />
                ))}
              </View>
              {["Red", "Green", "Blue"].map((channel, index) => (
                <View key={channel}>
                  <Text style={styles.text}>
                    {channel}: {rgb[index]}
                  </Text>
                  <View
                    style={{
                      height: 44,
                      backgroundColor: ["#ffb3b3", "#b3ffb3", "#b3c9ff"][index],
                      borderRadius: 8,
                    }}
                    onStartShouldSetResponder={() => true}
                    onMoveShouldSetResponder={() => true}
                    onResponderGrant={(e) => {
                      const next = [...rgb];
                      next[index] = Math.round(
                        Math.max(0, Math.min(1, e.nativeEvent.locationX / 240)) * 255,
                      );
                      setDraft("#" + next.map((v) => v.toString(16).padStart(2, "0")).join(""));
                    }}
                  >
                    <Text style={styles.text}>Tap to adjust</Text>
                  </View>
                </View>
              ))}
              <TextInput
                accessibilityLabel={`${label} hex color`}
                value={draft}
                onChangeText={setDraft}
                style={styles.input}
              />
              <Button
                label="Use color"
                onPress={
                  valid
                    ? () => {
                        onChange(draft.toUpperCase());
                        setOpen(false);
                      }
                    : undefined
                }
              />
              <Button label="Cancel" secondary onPress={() => setOpen(false)} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  field: { gap: 8, minWidth: 0 },
  label: { color: colors.text, fontSize: 13, fontWeight: "800" },
  text: { color: colors.text, fontSize: 14 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(7,26,93,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  dialog: {
    width: "100%",
    maxWidth: 430,
    maxHeight: "95%",
    backgroundColor: colors.surface,
    padding: 20,
    borderRadius: 20,
    gap: 12,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  timeOption: { height: 48, justifyContent: "center", alignItems: "center" },
});

import { Redirect } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@/auth/context";
import { Button, Card, Screen } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";

export default function LoginScreen() {
  const { user, requestCode, verifyCode } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [working, setWorking] = useState(false);

  if (user) return <Redirect href="/(tabs)" />;

  async function sendCode() {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) {
      Alert.alert("Enter your email", "Use the email address authorized for BrandSparQ.");
      return;
    }

    setWorking(true);
    try {
      const result = await requestCode(normalized);
      setSent(true);
      if (result.devCode) {
        Alert.alert("Development code", result.devCode);
      }
    } catch (error) {
      Alert.alert("Unable to send code", error instanceof Error ? error.message : "Try again.");
    } finally {
      setWorking(false);
    }
  }

  async function signIn() {
    setWorking(true);
    try {
      await verifyCode(email.trim().toLowerCase(), code.trim());
    } catch (error) {
      Alert.alert("Sign-in failed", error instanceof Error ? error.message : "Check the code and try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.shell}
      >
        <View style={styles.brand}>
          <Text style={styles.eyebrow}>BRANDSPARQ</Text>
          <Text style={styles.title}>Run your marketing from anywhere.</Text>
          <Text style={styles.sub}>
            Sign in with an authorized email. BrandSparQ will send a one-time code.
          </Text>
        </View>

        <Card>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            style={styles.input}
            editable={!sent}
          />

          {sent && (
            <>
              <Text style={styles.label}>Six-digit code</Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            </>
          )}

          <Button
            label={
              working
                ? "Working…"
                : sent
                  ? "Sign in"
                  : "Send sign-in code"
            }
            onPress={working ? undefined : sent ? signIn : sendCode}
          />

          {sent && (
            <Text
              onPress={() => {
                setSent(false);
                setCode("");
              }}
              style={styles.link}
            >
              Use a different email
            </Text>
          )}
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, justifyContent: "center", gap: spacing.xl },
  brand: { gap: spacing.sm },
  eyebrow: { color: colors.accent, fontWeight: "800", letterSpacing: 2 },
  title: { color: colors.text, fontSize: 34, lineHeight: 39, fontWeight: "900" },
  sub: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  input: {
    minHeight: 50,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  link: { color: colors.accent, fontWeight: "700", textAlign: "center", padding: 8 },
});

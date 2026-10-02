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
import { BrandLogo } from "@/components/brand";
import { Button, Card, PageScroll } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";

export default function LoginScreen() {
  const { user, requestCode, verifyCode } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [working, setWorking] = useState(false);
  const { wide } = useResponsive();

  if (user) return <Redirect href="/(tabs)" />;

  async function sendCode() {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) {
      Alert.alert(
        "Enter your email",
        "Use the email address authorized for BrandSparQ."
      );
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
      Alert.alert(
        "Unable to send code",
        error instanceof Error ? error.message : "Try again."
      );
    } finally {
      setWorking(false);
    }
  }

  async function signIn() {
    setWorking(true);
    try {
      await verifyCode(email.trim().toLowerCase(), code.trim());
    } catch (error) {
      Alert.alert(
        "Sign-in failed",
        error instanceof Error
          ? error.message
          : "Check the code and try again."
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <PageScroll contentStyle={styles.page}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.shell, wide && styles.shellWide]}
      >
        <View style={styles.brandPanel}>
          <BrandLogo showTagline />
          <View style={styles.brandCopy}>
            <Text style={styles.kicker}>AI MARKETING PRODUCTION</Text>
            <Text style={styles.title}>
              Create faster. Keep control.
            </Text>
            <Text style={styles.sub}>
              Upload images, generate branded campaigns, approve the work,
              and manage publishing from anywhere.
            </Text>
          </View>
          <View style={styles.sparkRow}>
            <View style={[styles.spark, { backgroundColor: colors.primary }]} />
            <View style={[styles.spark, { backgroundColor: colors.cyan }]} />
            <View style={[styles.spark, { backgroundColor: colors.orange }]} />
          </View>
        </View>

        <Card style={styles.loginCard}>
          <Text style={styles.cardTitle}>Sign in to BrandSparQ</Text>
          <Text style={styles.cardSub}>
            We’ll send a six-digit code to an authorized email.
          </Text>

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
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  page: {
    justifyContent: "center",
  },
  shell: {
    flex: 1,
    minHeight: 620,
    justifyContent: "center",
    gap: spacing.xl,
  },
  shellWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxl,
  },
  brandPanel: {
    flex: 1.15,
    gap: spacing.xl,
    paddingVertical: spacing.lg,
  },
  brandCopy: {
    gap: spacing.sm,
    maxWidth: 620,
  },
  kicker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  title: {
    color: colors.text,
    fontSize: 42,
    lineHeight: 47,
    fontWeight: "900",
    letterSpacing: -1.1,
  },
  sub: {
    color: colors.muted,
    fontSize: 17,
    lineHeight: 26,
  },
  sparkRow: {
    flexDirection: "row",
    gap: 8,
  },
  spark: {
    width: 34,
    height: 7,
    borderRadius: radius.pill,
  },
  loginCard: {
    flex: 0.85,
    width: "100%",
    maxWidth: 470,
    alignSelf: "center",
    gap: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  cardSub: {
    color: colors.muted,
    lineHeight: 21,
  },
  label: {
    color: colors.textSoft,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  input: {
    minHeight: 52,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  link: {
    color: colors.primary,
    fontWeight: "800",
    textAlign: "center",
    padding: 8,
  },
});

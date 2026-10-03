import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "@/auth/context";
import { BrandLogo } from "@/components/brand";
import { colors, radius, spacing } from "@/theme/tokens";

export default function LoginScreen() {
  const { user, signInWithGoogle, completeGoogleSignIn } = useAuth();
  const { handoff, auth_error: authError } =
    useLocalSearchParams<{ handoff?: string; auth_error?: string }>();

  const [working, setWorking] = useState(false);
  const [handoffHandled, setHandoffHandled] = useState(false);

  useEffect(() => {
    if (
      user ||
      handoffHandled ||
      typeof handoff !== "string" ||
      !handoff
    ) {
      return;
    }

    setHandoffHandled(true);
    setWorking(true);

    void completeGoogleSignIn(handoff)
      .catch((error) => {
        Alert.alert(
          "Google sign-in failed",
          error instanceof Error ? error.message : "Please try again."
        );
      })
      .finally(() => setWorking(false));
  }, [completeGoogleSignIn, handoff, handoffHandled, user]);

  useEffect(() => {
    if (typeof authError === "string" && authError) {
      Alert.alert("Google sign-in failed", authError);
    }
  }, [authError]);

  if (user) return <Redirect href="/(tabs)" />;

  async function startGoogleSignIn() {
    setWorking(true);

    try {
      await signInWithGoogle();
    } catch (error) {
      Alert.alert(
        "Google sign-in failed",
        error instanceof Error ? error.message : "Please try again."
      );
      setWorking(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.wrapper}>
          <View style={styles.logoWrap}>
            <BrandLogo compact />
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.subtitle}>
              Continue with your authorized Google account.
            </Text>

            <Pressable
              accessibilityRole="button"
              disabled={working}
              onPress={working ? undefined : startGoogleSignIn}
              style={({ pressed }) => [
                styles.googleButton,
                working && styles.disabled,
                pressed && !working && styles.pressed,
              ]}
            >
              {working ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <View style={styles.googleMark}>
                  <Text style={styles.googleMarkText}>G</Text>
                </View>
              )}

              <Text style={styles.googleButtonText}>
                {working ? "Signing in…" : "Continue with Google"}
              </Text>
            </Pressable>

            <Text style={styles.helper}>
              Only approved Google accounts can access this BrandSparQ workspace.
            </Text>
          </View>

          <Text style={styles.tagline}>CREATE. CAPTION. POST.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 28,
  },
  wrapper: {
    width: "100%",
    maxWidth: 380,
    alignSelf: "center",
    gap: spacing.md,
  },
  logoWrap: {
    alignItems: "center",
    marginBottom: 4,
  },
  card: {
    width: "100%",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 24,
    paddingVertical: 26,
    gap: 16,
    shadowColor: "#0A2A66",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  title: {
    color: colors.text,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: "900",
    textAlign: "center",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 2,
  },
  googleButton: {
    width: "100%",
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D5DEEA",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  googleMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E1E6EE",
  },
  googleMarkText: {
    color: "#4285F4",
    fontSize: 15,
    fontWeight: "900",
  },
  googleButtonText: {
    color: "#24324A",
    fontSize: 15,
    fontWeight: "800",
  },
  helper: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
  },
  tagline: {
    color: colors.text,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 2.5,
    textAlign: "center",
  },
  disabled: {
    opacity: 0.6,
  },
  pressed: {
    backgroundColor: "#F7FAFD",
  },
});

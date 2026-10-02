import { Ionicons } from "@expo/vector-icons";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "@/auth/context";
import { BrandLogo } from "@/components/brand";
import { Card, PageScroll } from "@/components/ui";
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
      Alert.alert("Google sign-in canceled", authError);
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
    <PageScroll contentStyle={styles.page}>
      <View style={styles.shell}>
        <View style={styles.logoWrap}>
          <BrandLogo compact />
        </View>

        <Card style={styles.loginCard}>
          <View style={styles.heading}>
            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.sub}>
              Continue with an authorized Google account to access BrandSparQ.
            </Text>
          </View>

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
              <Ionicons name="logo-google" size={20} color="#4285F4" />
            )}
            <Text style={styles.googleButtonText}>
              {working ? "Signing in…" : "Continue with Google"}
            </Text>
          </Pressable>

          <Text style={styles.helper}>
            Only Google accounts authorized for this BrandSparQ workspace can sign in.
          </Text>
        </Card>

        <Text style={styles.tagline}>CREATE. CAPTION. POST.</Text>
      </View>
    </PageScroll>
  );
}

const styles = StyleSheet.create({
  page: {
    justifyContent: "center",
  },
  shell: {
    flex: 1,
    minHeight: 520,
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  logoWrap: {
    alignItems: "center",
  },
  loginCard: {
    width: "100%",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heading: {
    gap: 6,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "900",
    textAlign: "center",
  },
  sub: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  googleButton: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#D5DEEA",
    backgroundColor: colors.white,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 11,
    paddingHorizontal: spacing.md,
  },
  googleButtonText: {
    color: "#24324A",
    fontSize: 15,
    fontWeight: "800",
  },
  helper: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  tagline: {
    color: colors.text,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 2.8,
    textAlign: "center",
  },
  disabled: {
    opacity: 0.62,
  },
  pressed: {
    backgroundColor: "#F7FAFD",
  },
});

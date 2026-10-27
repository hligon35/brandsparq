import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Text } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api } from "@/api/client";
import { useAuth } from "@/auth/context";
import { Alert } from "@/components/feedback";
import { formStyles as styles } from "@/components/forms";
import { Button, Card, PageHeader, PageScroll } from "@/components/ui";
export default function InvitationScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user, signOut, completeGoogleSignIn } = useAuth();
  const [data, setData] = useState<{ email: string; expiresAt: number }>();
  const [error, setError] = useState("");
  async function load() {
    try {
      setData((await api.getInvitation(token)).data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invitation unavailable.");
    }
  }
  useEffect(() => {
    void load();
  }, [token]);
  async function signIn() {
    try {
      const returnTo =
        Platform.OS === "web" ? `${window.location.origin}/login` : Linking.createURL("/login");
      const url = api.getGoogleAuthStartUrl(returnTo);
      if (Platform.OS === "web") {
        window.location.assign(url);
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(url, returnTo);
      if (result.type === "success") {
        const handoff = Linking.parse(result.url).queryParams?.handoff;
        if (typeof handoff === "string") await completeGoogleSignIn(handoff);
        else throw new Error("Sign-in did not complete.");
      }
    } catch (e) {
      Alert.alert("Unable to accept invitation", e instanceof Error ? e.message : "Try again.");
    }
  }
  return (
    <PageScroll>
      <PageHeader
        title="Join BrandSparQ"
        eyebrow="Team invitation"
        subtitle="Your owner has invited you to the workspace."
      />
      <Card>
        {error ? (
          <>
            <Text style={styles.error}>{error}</Text>
            <Button label="Try again" onPress={load} />
          </>
        ) : data ? (
          <>
            <Text style={styles.text}>
              Sign in with {data.email}. Your invitation expires{" "}
              {new Date(data.expiresAt).toLocaleDateString()}.
            </Text>
            {user ? (
              <>
                <Text style={styles.text}>
                  You are signed in as {user.email}. Continue with {data.email} to accept this
                  invitation.
                </Text>
                <Button
                  label="Switch Google account"
                  onPress={async () => {
                    try {
                      await signOut();
                      await signIn();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Unable to switch accounts.");
                    }
                  }}
                />
              </>
            ) : (
              <Button label="Accept with Google" onPress={signIn} />
            )}
          </>
        ) : (
          <Text style={styles.text}>Checking invitation…</Text>
        )}
      </Card>
    </PageScroll>
  );
}

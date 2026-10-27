import { readDraft, saveDraft } from "@/shared/draft-storage";
import { useUnsavedChanges, useGuardedNavigation } from "@/hooks/useUnsavedChanges";
import { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useAuth } from "@/auth/context";
import { api } from "@/api/client";
import { Alert } from "@/components/feedback";
import { Button, Card, PageHeader, PageScroll } from "@/components/ui";
import { colors } from "@/theme/tokens";
export default function ProfileScreen() {
  const { user, refreshUser, signOut } = useAuth();
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [currentEmail, setCurrentEmail] = useState(""),
    [avatar, setAvatar] = useState<string | null>(null),
    [avatarDirty, setAvatarDirty] = useState(false),
    [code, setCode] = useState(""),
    [codeSent, setCodeSent] = useState(false),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [confirm, setConfirm] = useState("");

  const draftKey = `brandsparq_profile_${user?.id || "anonymous"}`;
  const baseline = useRef({ name: "", email: "", avatar: null as string | null });
  const [draftNotice, setDraftNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const navigate = useGuardedNavigation();
  const { markSaved } = useUnsavedChanges({ name, email, avatar }, loaded, (saved) => {
    setName(saved.name);
    setEmail(saved.email);
    setAvatar(saved.avatar);
    setAvatarDirty(false);
    void saveDraft(draftKey, null).catch(() => undefined);
  });
  async function load() {
    setLoadError("");
    try {
      const { data } = await api.getProfile();
      setName(data.name || "");
      setEmail(data.email);
      setCurrentEmail(data.email);
      setAvatar(data.avatar_url);
      setAvatarDirty(false);

      baseline.current = { name: data.name || "", email: data.email, avatar: data.avatar_url };
      markSaved(baseline.current);
      const draft = await readDraft<typeof baseline.current>(draftKey).catch(() => null);
      if (draft) {
        setName(draft.name);
        setEmail(draft.email);
        setAvatar(draft.avatar);
        setAvatarDirty(draft.avatar !== data.avatar_url);
        setDraftNotice("Unsaved profile draft restored.");
      }
      setLoaded(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unable to load profile.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(
      () =>
        void saveDraft(
          draftKey,
          JSON.stringify({ name, email, avatar }) === JSON.stringify(baseline.current)
            ? null
            : { name, email, avatar },
        ).catch(() =>
          setDraftNotice(
            "Your draft could not be saved on this device. Save your changes before closing the app.",
          ),
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [name, email, avatar, loaded, draftKey]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      Alert.alert("Unable to update account", e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function chooseAvatar() {
    await act(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result.canceled) return;
      const image = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 256, height: 256 } }],
        { format: ImageManipulator.SaveFormat.PNG, base64: true },
      );
      setAvatar(`data:image/png;base64,${image.base64}`);
      setAvatarDirty(true);
    });
  }
  return (
    <PageScroll>
      <PageHeader title="Profile" subtitle="Manage your account and verified email address." />
      {!!draftNotice && (
        <Card subtle>
          <Text>{draftNotice}</Text>
        </Card>
      )}
      {!!loadError && (
        <Card>
          <Text accessibilityRole="alert">{loadError}</Text>
          <Button label="Try again" onPress={load} />
        </Card>
      )}
      {!loaded && !loadError && <Text>Loading profile…</Text>}
      <Card>
        <View style={{ alignItems: "center", gap: 12 }}>
          {avatar ? (
            <Image
              source={{ uri: avatar }}
              accessibilityLabel="Profile avatar"
              style={{ width: 96, height: 96, borderRadius: 48 }}
            />
          ) : (
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: colors.bgStrong,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 32, color: colors.primary }}>
                {name.slice(0, 1).toUpperCase() || "?"}
              </Text>
            </View>
          )}
          <Button
            label="Change avatar"
            secondary
            onPress={busy || !loaded ? undefined : chooseAvatar}
          />
          {!!avatar && (
            <Button
              label="Remove avatar"
              secondary
              small
              onPress={
                busy
                  ? undefined
                  : () => {
                      setAvatar(null);
                      setAvatarDirty(true);
                    }
              }
            />
          )}
        </View>
        <Text style={styles.label}>Name</Text>
        <TextInput
          accessibilityLabel="Profile name"
          editable={loaded && !busy}
          value={name}
          onChangeText={setName}
          style={styles.input}
        />
        <Button
          label="Save profile"
          onPress={
            busy || !loaded
              ? undefined
              : () =>
                  act(async () => {
                    await api.saveProfile(name, avatarDirty ? avatar : undefined);
                    setAvatarDirty(false);

                    // Saving profile fields must not mark an unverified email edit as saved.
                    baseline.current = { name, email: currentEmail, avatar };
                    markSaved(baseline.current);
                    await saveDraft(
                      draftKey,
                      email === currentEmail ? null : { name, email, avatar },
                    ).catch(() => undefined);
                    await refreshUser();
                    Alert.alert("Profile saved");
                  })
          }
        />
      </Card>
      <Card>
        <Text style={styles.label}>Email</Text>
        <TextInput
          accessibilityLabel="Profile email"
          editable={loaded && !busy}
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setCodeSent(false);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.input}
        />
        <Text style={styles.body}>
          Changes require a code sent to the new address. Continue signing in with your linked
          Google account.
        </Text>
        <Button
          label="Send verification code"
          secondary
          onPress={
            busy || !loaded || email.trim().toLowerCase() === currentEmail
              ? undefined
              : () =>
                  act(async () => {
                    await api.requestProfileEmail(email);
                    setCodeSent(true);
                    Alert.alert("Code sent", "Check the new email address for your 6-digit code.");
                  })
          }
        />
        {codeSent && (
          <>
            <TextInput
              accessibilityLabel="Email verification code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              style={styles.input}
            />
            <Button
              label="Verify email change"
              onPress={
                busy || code.length !== 6
                  ? undefined
                  : () =>
                      act(async () => {
                        await api.verifyProfileEmail(code);
                        await refreshUser();
                        const { data } = await api.getProfile();
                        setCurrentEmail(data.email);
                        setEmail(data.email);
                        baseline.current = { ...baseline.current, email: data.email };
                        markSaved(baseline.current);
                        await saveDraft(
                          draftKey,
                          JSON.stringify({ name, email: data.email, avatar }) ===
                            JSON.stringify(baseline.current)
                            ? null
                            : { name, email: data.email, avatar },
                        ).catch(() => undefined);
                        setCodeSent(false);
                        setCode("");
                        Alert.alert("Email updated");
                      })
              }
            />
          </>
        )}
      </Card>
      <Button
        label="Sign out"
        secondary
        onPress={busy ? undefined : () => void navigate(() => void act(signOut))}
      />
      <Card>
        <Text style={styles.label}>Delete account</Text>
        <Text style={styles.body}>
          This removes your profile details and workspace access and signs out all devices. Shared
          client work and operational history are retained. Another active owner is required before
          the last owner can delete their account.
        </Text>
        <TextInput
          accessibilityLabel="Type DELETE to confirm account deletion"
          placeholder="Type DELETE to confirm"
          value={confirm}
          onChangeText={setConfirm}
          style={styles.input}
        />
        <Button
          label="Delete account"
          danger
          onPress={
            busy || confirm !== "DELETE"
              ? undefined
              : () =>
                  act(async () => {
                    await api.deleteAccount();
                    await signOut().catch(() => undefined);
                  })
          }
        />
      </Card>
    </PageScroll>
  );
}
const styles = StyleSheet.create({
  label: { color: colors.text, fontWeight: "800", fontSize: 16 },
  body: { color: colors.muted, lineHeight: 22 },
  input: {
    minHeight: 48,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
  },
});

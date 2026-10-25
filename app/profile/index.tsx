import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useAuth } from "@/auth/context";
import { api } from "@/api/client";
import { Alert } from "@/components/feedback";
import { Button, Card, PageHeader, PageScroll } from "@/components/ui";
import { colors } from "@/theme/tokens";
export default function ProfileScreen() {
  const { refreshUser, signOut } = useAuth();
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
  async function load() {
    const { data } = await api.getProfile();
    setName(data.name || "");
    setEmail(data.email);
    setCurrentEmail(data.email);
    setAvatar(data.avatar_url);
    setAvatarDirty(false);
    setLoaded(true);
  }
  useEffect(() => {
    void load().catch((e) => Alert.alert("Unable to load profile", e.message));
  }, []);
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
          editable={!busy}
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
          editable={!busy}
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
                        await load();
                        setCodeSent(false);
                        setCode("");
                        Alert.alert("Email updated");
                      })
              }
            />
          </>
        )}
      </Card>
      <Button label="Sign out" secondary onPress={busy ? undefined : () => act(signOut)} />
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

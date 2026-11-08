import { createPushCleanupStore, type PushRegistration } from "./device-store";
import { readDraft, saveDraft } from "@/shared/draft-storage";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api, capturePushRegistration } from "@/api/client";
const key = "brandsparq_push_cleanup";
const legacyKey = "brandsparq_push_device";
const device = createPushCleanupStore({
  async read() {
    const state = await readDraft<any>(key);
    if (state) return state;
    const token = await SecureStore.getItemAsync(legacyKey);
    return token ? { current: { token, userId: "" }, pending: [] } : null;
  },
  async write(state) {
    await saveDraft(key, state);
    await SecureStore.deleteItemAsync(legacyKey);
  },
});
export function registerAndRememberPushToken(
  token: string,
  userId: string,
  prepare: (token: string) => Promise<{ cleanupToken: string }>,
  register: (token: string, cleanupToken: string) => Promise<unknown>,
  isCurrent: () => boolean,
) {
  return device.register(token, userId, prepare, register, isCurrent);
}
const revoke =
  (userId?: string, legacy: (token: string) => Promise<unknown> = api.unregisterPushToken) =>
  (entry: PushRegistration) => {
    if (entry.cleanupToken) return api.cleanupPushToken(entry.token, entry.cleanupToken);
    if (userId && entry.userId === userId) return legacy(entry.token);
    return Promise.reject(new Error("Legacy device cleanup needs its original account."));
  };
export function unregisterThisDevice(
  unregister: (token: string) => Promise<unknown> = api.unregisterPushToken,
  userId?: string,
) {
  return Platform.OS === "web"
    ? Promise.resolve()
    : device.unregister(userId, revoke(userId, unregister));
}
export async function retryPushCleanup(userId?: string) {
  if (Platform.OS === "web") return;
  await device.retry(revoke(userId), userId);
}
export async function upgradePushCleanup(userId: string) {
  if (Platform.OS === "web") return;
  const registration = capturePushRegistration();
  const token = await device.legacyToken();
  if (token)
    await device.register(
      token,
      userId,
      registration.prepare,
      (value, cleanupToken) => registration.register(value, Platform.OS, cleanupToken),
      registration.isCurrent,
    );
}

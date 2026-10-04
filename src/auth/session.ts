import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "brandsparq_session";

export async function getSessionToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return null;
    window.localStorage.removeItem(KEY);
    return window.sessionStorage.getItem(KEY);
  }
  return SecureStore.getItemAsync(KEY);
}

export async function setSessionToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    window.localStorage.removeItem(KEY);
    window.sessionStorage.setItem(KEY, token);
    return;
  }
  await SecureStore.setItemAsync(KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearSessionToken(): Promise<void> {
  if (Platform.OS === "web") {
    window.sessionStorage.removeItem(KEY);
    window.localStorage.removeItem(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}

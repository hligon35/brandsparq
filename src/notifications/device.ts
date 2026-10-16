import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api } from "@/api/client";
const key = "brandsparq_push_device";
export async function rememberPushToken(token: string) {
  if (Platform.OS !== "web") await SecureStore.setItemAsync(key, token);
}
export async function unregisterThisDevice() {
  if (Platform.OS === "web") return;
  const token = await SecureStore.getItemAsync(key);
  try {
    if (token) await api.unregisterPushToken(token);
  } finally {
    await SecureStore.deleteItemAsync(key);
  }
}

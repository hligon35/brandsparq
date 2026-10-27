import { createDeviceRegistrationStore } from "./device-store";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api } from "@/api/client";
const key = "brandsparq_push_device";
const device = createDeviceRegistrationStore({
  read: () => SecureStore.getItemAsync(key),
  write: (token) => SecureStore.setItemAsync(key, token),
  remove: () => SecureStore.deleteItemAsync(key),
});
export function registerAndRememberPushToken(
  token: string,
  register: (token: string) => Promise<unknown>,
  isCurrent: () => boolean,
) {
  return device.register(token, register, isCurrent);
}
export function unregisterThisDevice(
  unregister: (token: string) => Promise<unknown> = api.unregisterPushToken,
) {
  return Platform.OS === "web" ? Promise.resolve() : device.unregister(unregister);
}

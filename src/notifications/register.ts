import { Platform } from "react-native";
import { api } from "@/api/client";

export async function registerThisDeviceForPush() {
  if (Platform.OS === "web") {
    throw new Error("Push registration is available in the installed iOS or Android app.");
  }

  const Notifications = await import("expo-notifications");
  const ConstantsModule = await import("expo-constants");
  const Constants = ConstantsModule.default;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("brandsparq", {
      name: "BrandSparQ",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#0B78F6",
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }

  if (status !== "granted") {
    throw new Error("Push notification permission was not granted.");
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  if (!projectId) {
    throw new Error(
      "EAS projectId is not configured yet. Link the app to an EAS project before enabling push.",
    );
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

  await api.registerPushToken(token, Platform.OS);
  return token;
}

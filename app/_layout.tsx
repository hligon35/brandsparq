import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/auth/context";
import { colors } from "@/theme/tokens";

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="posts/[postId]" options={{ title: "Post Review", presentation: "modal" }} />
        <Stack.Screen name="posts/[postId]/publish" options={{ title: "Publish", presentation: "modal" }} />
        <Stack.Screen name="posts/[postId]/reschedule" options={{ title: "Reschedule", presentation: "modal" }} />
      </Stack>
    </AuthProvider>
  );
}

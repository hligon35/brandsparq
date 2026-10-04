import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/auth/context";
import { colors } from "@/theme/tokens";

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "800" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="review/[token]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="clients/index"
          options={{ title: "Clients" }}
        />
        <Stack.Screen
          name="clients/[clientId]/brand"
          options={{ title: "Brand Brain" }}
        />
        <Stack.Screen name="campaigns/index" options={{ title: "Campaigns" }} />
        <Stack.Screen name="campaigns/[campaignId]" options={{ title: "Campaign" }} />
        <Stack.Screen name="social/index" options={{ title: "Social Connections" }} />
        <Stack.Screen name="notifications/index" options={{ title: "Notifications" }} />
        <Stack.Screen name="analytics/index" options={{ title: "Analytics" }} />
        <Stack.Screen name="settings/index" options={{ title: "Settings" }} />
        <Stack.Screen name="access/index" options={{ title: "Access Management" }} />
        <Stack.Screen name="system/index" options={{ title: "System Health" }} />
        <Stack.Screen
          name="posts/[postId]"
          options={{ title: "Post Review", presentation: "modal" }}
        />
        <Stack.Screen
          name="posts/[postId]/publish"
          options={{ title: "Publish", presentation: "modal" }}
        />
        <Stack.Screen
          name="posts/[postId]/reschedule"
          options={{ title: "Reschedule", presentation: "modal" }}
        />
      </Stack>
    </AuthProvider>
  );
}

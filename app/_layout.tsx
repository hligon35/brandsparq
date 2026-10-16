import { NotificationRouter } from "@/notifications/router";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "@/auth/context";
import { colors } from "@/theme/tokens";
import { FeedbackHost } from "@/components/feedback";

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
      <FeedbackHost />
      <NotificationRouter />
    </AuthProvider>
  );
}

function RootNavigator() {
  const { user } = useAuth();
  return (
    <>
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
        <Stack.Protected guard={!user}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

          <Stack.Screen name="generation/index" options={{ title: "Generation progress" }} />
          <Stack.Screen name="paused/index" options={{ title: "Paused content" }} />
          <Stack.Screen
            name="clients/[clientId]/reviewers"
            options={{ title: "Client reviewers" }}
          />
          <Stack.Screen name="clients/index" options={{ title: "Clients" }} />
          <Stack.Screen name="clients/[clientId]/brand" options={{ title: "Brand Brain" }} />
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
        </Stack.Protected>
        <Stack.Screen name="invite/[token]" options={{ headerShown: false }} />
        <Stack.Screen name="review/[token]" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

import { useGuardedNavigation } from "@/hooks/useUnsavedChanges";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/context";
export function NotificationRouter() {
  const { user } = useAuth();
  const router = useRouter();
  const navigate = useGuardedNavigation();
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (Platform.OS === "web" || !user) return;
    let active = true;
    let subscription: { remove(): void } | undefined;
    void import("expo-notifications")
      .then(async (Notifications) => {
        if (!active) return;
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });
        const open = (response: import("expo-notifications").NotificationResponse | null) => {
          if (!active || !response) return;
          const request = response.notification.request;
          if (handled.current === request.identifier) return;
          const data = request.content.data;
          const postId = data?.postId;
          if (data?.userId !== user.id) return;
          // Route only known internal post IDs; never execute arbitrary push-provided URLs.
          if (typeof postId !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(postId)) return;
          void navigate(() => {
            handled.current = request.identifier;
            router.push(
              data?.type === "pre_publish" ? `/posts/${postId}/publish` : `/posts/${postId}`,
            );
          });
        };
        subscription = Notifications.addNotificationResponseReceivedListener(open);
        open(await Notifications.getLastNotificationResponseAsync());
      })
      .catch(() => undefined);
    return () => {
      active = false;
      subscription?.remove();
    };
  }, [user?.id]);
  return null;
}

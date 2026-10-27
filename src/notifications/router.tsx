import { pushNotificationTarget } from "@/shared/notification-route";
import { api } from "@/api/client";
import { useInbox } from "@/notifications/inbox";
import { useGuardedNavigation } from "@/hooks/useUnsavedChanges";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useAuth } from "@/auth/context";
export function NotificationRouter() {
  const { refresh } = useInbox();
  const { user } = useAuth();
  const router = useRouter();
  const navigate = useGuardedNavigation();
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (Platform.OS === "web" || !user) return;
    let active = true;
    let subscription: { remove(): void } | undefined;
    let received: { remove(): void } | undefined;
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
          const target = pushNotificationTarget(data || {}, user.id);
          if (!target) return;
          void navigate(() => {
            handled.current = request.identifier;
            if (target.notificationId)
              void api
                .markNotificationRead(target.notificationId)
                .then(refresh)
                .catch(() => undefined);
            router.push(target.path as Href);
          });
        };
        received = Notifications.addNotificationReceivedListener(() => void refresh());
        subscription = Notifications.addNotificationResponseReceivedListener(open);
        open(await Notifications.getLastNotificationResponseAsync());
      })
      .catch(() => undefined);
    return () => {
      active = false;
      subscription?.remove();
      received?.remove();
    };
  }, [user?.id]);
  return null;
}

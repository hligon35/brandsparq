import { createActiveRefresh } from "@/shared/active-refresh";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  useRef,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import { useAuth } from "@/auth/context";
import { api } from "@/api/client";
const Inbox = createContext({ unreadCount: 0, refresh: async () => {} });
export function InboxProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const controller = useRef<ReturnType<typeof createActiveRefresh> | null>(null);
  const refresh = useCallback(async () => {
    await controller.current?.request();
  }, []);
  useEffect(() => {
    setUnreadCount(0);
    if (!user) return;
    const active = createActiveRefresh(async (context) => {
      try {
        const result = await api.getNotifications({ limit: "1" });
        if (context.current()) setUnreadCount(result.unreadCount);
      } catch {
        /* Keep last known count on transient network failures. */
      }
    }, 30000);
    controller.current = active;
    active.setActive(AppState.currentState == null || AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) =>
      active.setActive(state === "active"),
    );
    return () => {
      subscription.remove();
      active.dispose();
      if (controller.current === active) controller.current = null;
    };
  }, [user?.id]);
  return <Inbox.Provider value={{ unreadCount, refresh }}>{children}</Inbox.Provider>;
}
export const useInbox = () => useContext(Inbox);

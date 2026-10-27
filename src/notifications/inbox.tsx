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
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    if (!user) {
      setUnreadCount(0);
      return;
    }
    try {
      const result = await api.getNotifications({ limit: "1" });
      if (current === version.current) setUnreadCount(result.unreadCount);
    } catch {
      /* Keep last known count on transient network failures. */
    }
  }, [user?.id]);
  useEffect(() => {
    setUnreadCount(0);
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      version.current++;
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);
  return <Inbox.Provider value={{ unreadCount, refresh }}>{children}</Inbox.Provider>;
}
export const useInbox = () => useContext(Inbox);

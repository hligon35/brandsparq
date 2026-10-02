import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, setApiSessionToken } from "@/api/client";
import {
  clearSessionToken,
  getSessionToken,
  setSessionToken,
} from "@/auth/session";

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  role: string;
};

type AuthValue = {
  ready: boolean;
  user: AuthUser | null;
  requestCode(email: string): Promise<{ devCode?: string }>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await getSessionToken();
      if (!token) {
        setReady(true);
        return;
      }

      setApiSessionToken(token);
      try {
        const session = await api.getSession();
        setUser(session.user);
      } catch {
        setApiSessionToken(null);
        await clearSessionToken();
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      user,
      async requestCode(email) {
        return api.requestAuthCode(email);
      },
      async verifyCode(email, code) {
        const result = await api.verifyAuthCode(email, code);
        setApiSessionToken(result.token);
        await setSessionToken(result.token);
        setUser(result.user);
      },
      async signOut() {
        try {
          await api.signOut();
        } finally {
          setApiSessionToken(null);
          await clearSessionToken();
          setUser(null);
        }
      },
    }),
    [ready, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

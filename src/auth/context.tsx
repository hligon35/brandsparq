import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
import { api, setApiSessionToken } from "@/api/client";
import {
  clearSessionToken,
  getSessionToken,
  setSessionToken,
} from "@/auth/session";

WebBrowser.maybeCompleteAuthSession();

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  role: string;
};

type AuthValue = {
  ready: boolean;
  user: AuthUser | null;
  signInWithGoogle(): Promise<void>;
  completeGoogleSignIn(handoff: string): Promise<void>;
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

  const completeGoogleSignIn = useCallback(async (handoff: string) => {
    const result = await api.completeGoogleAuth(handoff);
    setApiSessionToken(result.token);
    await setSessionToken(result.token);
    setUser(result.user);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const returnTo =
      Platform.OS === "web"
        ? `${window.location.origin}/login`
        : Linking.createURL("/login");

    const startUrl = api.getGoogleAuthStartUrl(returnTo);

    if (Platform.OS === "web") {
      window.location.assign(startUrl);
      return;
    }

    const result = await WebBrowser.openAuthSessionAsync(startUrl, returnTo);
    if (result.type === "cancel" || result.type === "dismiss") {
      throw new Error("Google sign-in was canceled.");
    }
    if (result.type !== "success" || !result.url) {
      throw new Error("Google did not return a sign-in result.");
    }

    const parsed = Linking.parse(result.url);
    const handoff =
      typeof parsed.queryParams?.handoff === "string"
        ? parsed.queryParams.handoff
        : undefined;

    if (!handoff) {
      const authError =
        typeof parsed.queryParams?.auth_error === "string"
          ? parsed.queryParams.auth_error
          : "Google sign-in did not complete.";
      throw new Error(authError);
    }

    await completeGoogleSignIn(handoff);
  }, [completeGoogleSignIn]);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      user,
      signInWithGoogle,
      completeGoogleSignIn,
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
    [completeGoogleSignIn, ready, signInWithGoogle, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

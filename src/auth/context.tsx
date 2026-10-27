import { unregisterThisDevice } from "@/notifications/device";
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
  useRef,
} from "react";
import { ActivityIndicator, AppState, Platform, View } from "react-native";
import { colors } from "@/theme/tokens";
import { api, setApiSessionToken, setUnauthorizedHandler } from "@/api/client";
import { clearSessionToken, getSessionToken, setSessionToken } from "@/auth/session";

WebBrowser.maybeCompleteAuthSession();

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  role: string;
  clientRoles?: Record<string, string>;
};

type AuthValue = {
  ready: boolean;
  user: AuthUser | null;
  signInWithGoogle(): Promise<void>;
  completeGoogleSignIn(handoff: string): Promise<void>;
  signOut(): Promise<void>;
  refreshUser(): Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const handoffRequest = useRef<{ handoff: string; promise: Promise<void> } | null>(null);
  const sessionEpoch = useRef(0);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      sessionEpoch.current++;
      setApiSessionToken(null);
      await clearSessionToken();
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const token = await getSessionToken();
        if (token) {
          setApiSessionToken(token);
          const session = await api.getSession();
          setUser(session.user);
        }
      } catch {
        setApiSessionToken(null);
        await clearSessionToken().catch(() => undefined);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Refresh capabilities when the app returns to the foreground and while it stays open.
  // A late refresh from an old session must never restore a signed-out user.
  const currentUser = useRef(user);
  currentUser.current = user;
  useEffect(() => {
    if (!user) return;
    let active = true;
    const epoch = sessionEpoch.current;
    const refresh = async () => {
      try {
        const result = await api.getSession();
        if (active && epoch === sessionEpoch.current && currentUser.current?.id === user.id)
          setUser(result.user);
      } catch {
        /* Authorization failures are handled centrally; transient failures retain the UI. */
      }
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    const timer = setInterval(() => void refresh(), 60000);
    return () => {
      active = false;
      subscription.remove();
      clearInterval(timer);
    };
  }, [user?.id]);

  const completeGoogleSignIn = useCallback((handoff: string) => {
    if (handoffRequest.current?.handoff === handoff) return handoffRequest.current.promise;
    // Deep-link and auth-session callbacks can both receive the same native handoff.
    const promise = (async () => {
      const result = await api.completeGoogleAuth(handoff);
      setApiSessionToken(result.token);
      await setSessionToken(result.token);
      setUser((await api.getSession()).user);
    })();
    handoffRequest.current = { handoff, promise };
    return promise;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const returnTo =
      Platform.OS === "web" ? `${window.location.origin}/login` : Linking.createURL("/login");

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
      typeof parsed.queryParams?.handoff === "string" ? parsed.queryParams.handoff : undefined;

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
      async refreshUser() {
        const epoch = sessionEpoch.current;
        const result = await api.getSession();
        if (epoch === sessionEpoch.current) setUser(result.user);
      },
      signInWithGoogle,
      completeGoogleSignIn,
      async signOut() {
        sessionEpoch.current++;
        try {
          await unregisterThisDevice().catch(() => undefined);
          await api.signOut();
        } finally {
          handoffRequest.current = null;
          setApiSessionToken(null);
          await clearSessionToken();
          setUser(null);
        }
      },
    }),
    [completeGoogleSignIn, ready, signInWithGoogle, user],
  );

  return (
    <AuthContext.Provider value={value}>
      {ready ? (
        children
      ) : (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.bg,
          }}
        >
          <ActivityIndicator accessibilityLabel="Restoring session" color={colors.primary} />
        </View>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

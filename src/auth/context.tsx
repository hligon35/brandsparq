import { Button } from "@/components/ui";
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
import { ActivityIndicator, AppState, Platform, View, Text } from "react-native";
import { colors } from "@/theme/tokens";
import {
  api,
  captureSessionCleanup,
  setApiSessionToken,
  setUnauthorizedHandler,
} from "@/api/client";
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
  notice: string | null;
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
  const [notice, setNotice] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [clearFailed, setClearFailed] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      const epoch = ++sessionEpoch.current;
      setApiSessionToken(null);
      setUser(null);
      setNotice("The saved sign-in is no longer valid. Please sign in again.");
      setReady(true);
      setRestoreError(null);
      try {
        await clearSessionToken();
      } catch {
        if (epoch === sessionEpoch.current) {
          setClearFailed(true);
          setRestoreError("Unable to remove the saved sign-in. Please retry signing out.");
        }
      }
    });
    return () => {
      sessionEpoch.current++;
      setUnauthorizedHandler(null);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const epoch = ++sessionEpoch.current;
    const current = () => active && epoch === sessionEpoch.current;
    setReady(false);
    setRestoreError(null);
    const timer = setTimeout(() => {
      if (!current()) return;
      sessionEpoch.current++;
      setRestoreError(
        "Your saved sign-in could not be checked. Check your connection and try again.",
      );
      setReady(true);
    }, 10000);
    void (async () => {
      try {
        const token = await getSessionToken();
        if (!current()) return;
        if (token) {
          setApiSessionToken(token);
          const session = await api.getSession();
          if (current()) setUser(session.user);
        }
      } catch (error) {
        // A timeout/offline response is not proof that the credential expired.
        // Authentication failures are cleared by the scoped 401 handler above.
        if (current())
          setRestoreError(
            error instanceof Error
              ? error.message
              : "Unable to restore your sign-in. Please try again.",
          );
      } finally {
        clearTimeout(timer);
        if (current()) setReady(true);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [restoreAttempt]);

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
    // Deep-link and auth-session callbacks share one handoff. Every asynchronous
    // boundary is fenced so a canceled/older sign-in cannot restore the user.
    const epoch = ++sessionEpoch.current;
    setNotice(null);
    const current = () => epoch === sessionEpoch.current;
    const promise = (async () => {
      const result = await api.completeGoogleAuth(handoff);
      if (!current()) return;
      setApiSessionToken(result.token);
      try {
        await setSessionToken(result.token);
      } catch {
        if (current()) {
          const cleanup = captureSessionCleanup();
          setApiSessionToken(null);
          void cleanup.signOut().catch(() => undefined);
        }
        throw new Error("Unable to save your sign-in on this device. Please try again.");
      }
      if (!current()) return;
      try {
        const session = await api.getSession();
        if (current()) setUser(session.user);
      } catch (error) {
        if (current()) {
          setRestoreError(
            error instanceof Error
              ? error.message
              : "Your sign-in was saved. Retry the connection to continue.",
          );
          setReady(true);
        }
      }
    })().catch((error) => {
      if (current()) throw error;
    });
    handoffRequest.current = { handoff, promise };
    void promise.catch(() => {
      if (handoffRequest.current?.promise === promise) handoffRequest.current = null;
    });
    return promise;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setNotice(null);
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
      notice,
      user,
      async refreshUser() {
        const epoch = sessionEpoch.current;
        const result = await api.getSession();
        if (epoch === sessionEpoch.current) setUser(result.user);
      },
      signInWithGoogle,
      completeGoogleSignIn,
      async signOut() {
        const epoch = ++sessionEpoch.current;
        handoffRequest.current = null;
        const cleanup = captureSessionCleanup();
        // Revoke with captured credentials; never let a late cleanup sign out a
        // newly connected account. Local sign-out does not wait for the network.
        void (async () => {
          try {
            await unregisterThisDevice(cleanup.unregisterPushToken);
          } catch {
            /* Retry requires connectivity; local sign-out still completes. */
          } finally {
            await cleanup.signOut().catch(() => undefined);
          }
        })();
        setApiSessionToken(null);
        setUser(null);
        setNotice(null);
        setRestoreError(null);
        setClearFailed(false);
        setReady(true);
        try {
          await clearSessionToken();
        } catch {
          if (epoch === sessionEpoch.current) {
            setClearFailed(true);
            setRestoreError("Unable to remove the saved sign-in. Please retry signing out.");
          }
        }
      },
    }),
    [completeGoogleSignIn, ready, notice, signInWithGoogle, user],
  );

  return (
    <AuthContext.Provider value={value}>
      {restoreError ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 24,
            gap: 16,
            backgroundColor: colors.bg,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{ fontSize: 24, fontWeight: "800", color: colors.text }}
          >
            Restore your session
          </Text>
          <Text accessibilityRole="alert" style={{ color: colors.text }}>
            {restoreError}
          </Text>
          <Button
            label={clearFailed ? "Retry sign out" : "Retry connection"}
            onPress={() => {
              if (clearFailed) void value.signOut();
              else {
                setReady(false);
                setRestoreError(null);
                setRestoreAttempt((attempt) => attempt + 1);
              }
            }}
          />
          {!clearFailed && (
            <Button label="Sign out" secondary onPress={() => void value.signOut()} />
          )}
        </View>
      ) : ready ? (
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

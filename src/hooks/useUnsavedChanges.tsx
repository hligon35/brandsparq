import {
  createContext,
  useEffect,
  useCallback,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type PropsWithChildren,
} from "react";
import { Link as ExpoLink, useFocusEffect, usePreventRemove, useRouter } from "expo-router";
import { confirmAction } from "@/components/feedback";

type Guard = { dirty(): boolean; leave(): Promise<boolean> };
const NavigationGuard = createContext<{ current: Guard | null; navigating?: boolean }>({
  current: null,
});

export function UnsavedChangesProvider({ children }: PropsWithChildren) {
  const guard = useRef<Guard | null>(null);
  return <NavigationGuard.Provider value={guard}>{children}</NavigationGuard.Provider>;
}

export function useGuardedNavigation() {
  const guard = useContext(NavigationGuard);
  return useCallback(
    async (action: () => void) => {
      if (guard.navigating) return;
      guard.navigating = true;
      try {
        if (!guard.current || (await guard.current.leave())) action();
      } finally {
        guard.navigating = false;
      }
    },
    [guard],
  );
}

/** Protect pushes from shared chrome as well as links inside editable screens. */
export function GuardedLink(props: ComponentProps<typeof ExpoLink>) {
  const guard = useContext(NavigationGuard);
  const run = useGuardedNavigation();
  const router = useRouter();
  return (
    <ExpoLink
      {...props}
      onPress={(event) => {
        props.onPress?.(event);
        if (event.defaultPrevented || !guard.current?.dirty()) return;
        if (props.target === "_blank") return;
        if (
          "metaKey" in event &&
          (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        )
          return;
        event.preventDefault();
        void run(() => router.navigate(props.href));
      }}
    />
  );
}

export function useUnsavedChanges<T>(value: T, enabled = true, restore?: (value: T) => void) {
  const serialized = JSON.stringify(value);
  const [saved, setSaved] = useState<string | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const [discarded, setDiscarded] = useState(false);
  const dirty = enabled && saved !== null && serialized !== saved && !discarded;
  useEffect(() => {
    if (!dirty || typeof window === "undefined") return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const pending = useRef<Promise<boolean> | null>(null);
  const release = useRef<() => void>(() => {});
  const context = useContext(NavigationGuard);
  const leave = useCallback(() => {
    if (!dirtyRef.current) return Promise.resolve(true);
    if (pending.current) return pending.current;
    pending.current = confirmAction(
      "Discard unsaved changes?",
      "Your changes have not been saved. Stay here to save them, or discard them and leave.",
      "Discard changes",
      "Keep editing",
    )
      .then((confirmed) => {
        if (confirmed) {
          if (savedRef.current !== null) restoreRef.current?.(JSON.parse(savedRef.current));
          dirtyRef.current = false;
          setDiscarded(true);
          release.current();
        }
        return confirmed;
      })
      .finally(() => {
        pending.current = null;
      });
    return pending.current;
  }, []);
  release.current = usePreventRemove(dirty, ({ repeat }) => {
    if (pending.current) return;
    void leave().then((confirmed) => {
      if (confirmed) repeat();
    });
  });
  useFocusEffect(
    useCallback(() => {
      setDiscarded(false);
      const guard = { dirty: () => dirtyRef.current, leave };
      context.current = guard;
      return () => {
        if (context.current === guard) context.current = null;
      };
    }, [context, leave]),
  );
  const markSaved = useCallback((next: T) => {
    savedRef.current = JSON.stringify(next);
    setSaved(savedRef.current);
    setDiscarded(false);
  }, []);
  return { dirty, markSaved, discardChanges: leave };
}

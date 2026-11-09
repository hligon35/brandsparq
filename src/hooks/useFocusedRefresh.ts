import { useCallback, useMemo, useRef, type DependencyList } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";
import { createActiveRefresh, type RefreshContext } from "@/shared/active-refresh";

export function useFocusedRefresh(
  task: (context: RefreshContext) => Promise<unknown>,
  dependencies: DependencyList,
  intervalMs = 0,
) {
  const latest = useRef(task);
  latest.current = task;
  const current = useRef<ReturnType<typeof createActiveRefresh> | null>(null);
  useFocusEffect(
    useCallback(() => {
      const refresh = createActiveRefresh((context) => latest.current(context), intervalMs);
      current.current = refresh;
      refresh.setActive(AppState.currentState == null || AppState.currentState === "active");
      const subscription = AppState.addEventListener("change", (state) =>
        refresh.setActive(state === "active"),
      );
      return () => {
        subscription.remove();
        refresh.dispose();
        if (current.current === refresh) current.current = null;
      };
    }, [...dependencies, intervalMs]),
  );
  return useMemo(
    () =>
      Object.assign(() => current.current?.request("manual") || Promise.resolve(), {
        active: () => current.current?.isActive() || false,
      }),
    [],
  );
}

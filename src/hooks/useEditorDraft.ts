import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { readDraft, saveDraft } from "@/shared/draft-storage";
import { createEditorDraft } from "@/shared/editor-draft";
import { useUnsavedChanges } from "./useUnsavedChanges";

export function useEditorDraft<T>(
  key: string,
  value: T,
  allowed: boolean,
  restore: (value: T) => void,
) {
  const controller = useMemo(
    () =>
      createEditorDraft<T>({ read: () => readDraft(key), write: (draft) => saveDraft(key, draft) }),
    [key],
  );
  const [state, setState] = useState({ key: "", ready: false, pending: false, notice: "" });
  const currentKey = useRef(key);
  const live = useRef(true);
  currentKey.current = key;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const ready = state.key === key && state.ready;
  if (ready && allowed) controller.update(value);
  const guard = useUnsavedChanges(value, allowed && ready, async (saved) => {
    controller.update(saved);
    restoreRef.current(saved);
    await controller.flush().catch(() => undefined);
  });
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (!ready || !allowed || state.pending) return;
    const timer = setTimeout(
      () =>
        void controller.flush().catch(() => {
          if (currentKey.current === key)
            setState((old) => ({
              ...old,
              notice:
                "Your draft could not be saved on this device. Save your changes before closing the app.",
            }));
        }),
      250,
    );
    return () => clearTimeout(timer);
  }, [controller, key, ready, allowed, serialized, state.pending, guard.dirty]);
  useEffect(() => {
    live.current = true;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") void controller.flush().catch(() => undefined);
    });
    return () => {
      live.current = false;
      controller.close();
      subscription.remove();
      void controller.flush().catch(() => undefined);
    };
  }, [controller]);
  async function initialize(
    saved: T,
    options: { recover?: boolean; clear?: boolean; persist?: boolean } = {},
  ) {
    if (!live.current || currentKey.current !== key) return;
    const result = await controller.initialize(saved, options);
    if (!result || !live.current || currentKey.current !== key) return;
    guard.markSaved(saved);
    restoreRef.current(result.value);
    setState({ key, ready: true, pending: result.pending, notice: result.notice });
  }
  function markSaved(saved: T) {
    controller.markSaved(saved);
    guard.markSaved(saved);
  }
  async function choose(restoreDraft: boolean) {
    const next = controller.chooseRecovered(restoreDraft);
    restoreRef.current(next);
    setState((old) => ({
      ...old,
      pending: false,
      notice: restoreDraft
        ? "Recovered draft restored. Review your changes before saving."
        : "Recovered draft discarded. Latest saved work is shown.",
    }));
    await controller.flush().catch(() => undefined);
  }
  return {
    ...guard,
    markSaved,
    initialize,
    flush: () => controller.flush(),
    ready,
    notice: state.key === key ? state.notice : "",
    pending: state.key === key && state.pending,
    restoreRecovered: () => choose(true),
    discardRecovered: () => choose(false),
  };
}

type UnloadTarget = {
  addEventListener?: (type: "beforeunload", listener: (event: BeforeUnloadEvent) => void) => void;
  removeEventListener?: (
    type: "beforeunload",
    listener: (event: BeforeUnloadEvent) => void,
  ) => void;
};

/** React Native defines `window` too, without browser unload events. */
export function protectBrowserUnload(
  platform: string,
  target: UnloadTarget | undefined,
  isDirty: () => boolean,
) {
  if (
    platform !== "web" ||
    typeof target?.addEventListener !== "function" ||
    typeof target.removeEventListener !== "function"
  )
    return;

  const prevent = (event: BeforeUnloadEvent) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  target.addEventListener("beforeunload", prevent);
  return () => target.removeEventListener!("beforeunload", prevent);
}

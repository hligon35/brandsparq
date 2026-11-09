export type RefreshContext = { reason: "foreground" | "poll" | "manual"; current(): boolean };
/** One request at a time; hidden/background screens cannot schedule more work. */
export function createActiveRefresh(
  task: (context: RefreshContext) => Promise<unknown>,
  intervalMs = 0,
  timers = {
    set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
    clear: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
) {
  let active = false,
    disposed = false,
    version = 0;
  let timer: unknown,
    running: Promise<void> | undefined,
    requested: RefreshContext["reason"] | undefined;
  const cancel = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
  };
  function schedule() {
    cancel();
    if (active && !disposed && intervalMs > 0)
      timer = timers.set(() => {
        timer = undefined;
        void request("poll");
      }, intervalMs);
  }
  function request(reason: RefreshContext["reason"] = "manual"): Promise<void> {
    if (!active || disposed) return Promise.resolve();
    cancel();
    requested = reason;
    if (!running)
      running = (async () => {
        while (active && !disposed && requested) {
          const reason = requested,
            attempt = version;
          requested = undefined;
          try {
            await task({ reason, current: () => active && !disposed && attempt === version });
          } catch {
            /* Each screen owns its visible recovery state; never leak an unhandled rejection. */
          }
        }
      })().finally(() => {
        running = undefined;
        schedule();
      });
    return running;
  }
  return {
    request,
    isActive: () => active && !disposed,
    setActive(next: boolean) {
      if (disposed || next === active) return;
      active = next;
      version++;
      cancel();
      if (active) void request("foreground");
      else requested = undefined;
    },
    dispose() {
      disposed = true;
      active = false;
      requested = undefined;
      version++;
      cancel();
    },
  };
}

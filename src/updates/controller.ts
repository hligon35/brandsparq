export type UpdateSnapshot = {
  phase:
    | "idle"
    | "checking"
    | "downloading"
    | "ready"
    | "applying"
    | "current"
    | "error"
    | "unavailable";
  busy: boolean;
  ready: boolean;
  message: string;
};
type Adapter = {
  enabled(): boolean;
  pending(): boolean;
  check(): Promise<{ isAvailable: boolean; isRollBackToEmbedded?: boolean }>;
  download(): Promise<{ isNew: boolean; isRollBackToEmbedded?: boolean }>;
  confirmRestart(): Promise<boolean>;
  beforeRestart(): Promise<boolean>;
  reload(): Promise<void>;
  changed(state: UpdateSnapshot): void;
};

/** No channel/URL override: native Expo selects updates for the installed build. */
export function createUpdateController(adapter: Adapter) {
  let busy = false,
    ready = adapter.enabled() && adapter.pending(),
    disposed = false;
  function emit(phase: UpdateSnapshot["phase"], message: string) {
    if (!disposed) adapter.changed({ phase, busy, ready, message });
  }
  return {
    markReady() {
      if (!adapter.enabled()) return;
      ready = true;
      if (!busy) emit("ready", "An app update is downloaded and ready to apply.");
    },
    async check() {
      if (disposed || busy) return;
      if (!adapter.enabled()) {
        emit("unavailable", "Install an update-enabled standalone build to use app updates.");
        return;
      }
      if (ready || adapter.pending()) {
        ready = true;
        emit("ready", "An app update is downloaded and ready to apply.");
        return;
      }
      busy = true;
      emit("checking", "Checking for a compatible app update…");
      try {
        const check = await adapter.check();
        if (disposed) return;
        if (!check.isAvailable && !check.isRollBackToEmbedded) {
          busy = false;
          ready = adapter.pending();
          emit(
            ready ? "ready" : "current",
            ready
              ? "An app update is downloaded and ready to apply."
              : "You’re up to date for this installed build.",
          );
          return;
        }
        emit("downloading", "Downloading the app update…");
        const result = await adapter.download();
        if (disposed) return;
        ready = result.isNew || !!result.isRollBackToEmbedded || adapter.pending();
        busy = false;
        emit(
          ready ? "ready" : "current",
          ready
            ? result.isRollBackToEmbedded
              ? "A recovery update is ready to apply."
              : "Update downloaded. Restart when you’re ready."
            : "No newer compatible update was downloaded.",
        );
      } catch {
        busy = false;
        ready = ready || adapter.pending();
        emit(
          "error",
          ready
            ? "The update is still downloaded. Try restarting again."
            : "Unable to download an app update. Check your connection and try again.",
        );
      } finally {
        busy = false;
      }
    },
    async apply() {
      if (disposed || busy || !adapter.enabled() || !(ready || adapter.pending())) return;
      ready = true;
      busy = true;
      emit("ready", "Update downloaded. Confirm when you’re ready to restart.");
      try {
        if (!(await adapter.confirmRestart()) || disposed || !(await adapter.beforeRestart())) {
          if (disposed) return;
          busy = false;
          emit("ready", "Update downloaded. You can restart later.");
          return;
        }
        if (disposed) return;
        emit("applying", "Restarting to apply the update…");
        await adapter.reload();
      } catch {
        busy = false;
        emit("error", "Unable to restart. Your downloaded update is saved; try again.");
      } finally {
        busy = false;
      }
    },
    dispose() {
      disposed = true;
    },
  };
}

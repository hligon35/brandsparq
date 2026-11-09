type Draft<T> = { version: 1; baseline: T; value: T };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function compatible(value: unknown, example: unknown): boolean {
  if (Array.isArray(example))
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  if (example && typeof example === "object")
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === Object.keys(example).length &&
      Object.entries(example).every(
        ([key, field]) =>
          Object.hasOwn(value, key) && compatible((value as Record<string, unknown>)[key], field),
      )
    );
  return typeof value === typeof example && (typeof value !== "number" || Number.isFinite(value));
}
export function editorDraftKey(userId: string, kind: string, entityId: string) {
  const encode = (value: string) =>
    [...value].map((c) => c.codePointAt(0)!.toString(16).padStart(6, "0")).join("");
  return `brandsparq_editor_${encode(userId)}_${encode(kind)}_${encode(entityId)}`;
}

/** A draft never writes to the API, and stale recovery requires an explicit choice. */
export function createEditorDraft<T>(storage: {
  read(): Promise<unknown>;
  write(value: Draft<T> | null): Promise<void>;
}) {
  let writing: Promise<void> | undefined;
  let queued: Draft<T> | null | undefined;
  function writeLatest(value: Draft<T> | null) {
    queued = value;
    if (!writing)
      writing = (async () => {
        while (queued !== undefined) {
          const next = queued;
          queued = undefined;
          await storage.write(next);
        }
      })().finally(() => {
        writing = undefined;
      });
    return writing;
  }
  let baseline: T,
    current: T,
    pending: T | undefined,
    opened = false,
    version = 0,
    persist = true;
  return {
    async initialize(
      saved: T,
      options: { recover?: boolean; clear?: boolean; persist?: boolean } = {},
    ) {
      const attempt = ++version;
      opened = false;
      persist = options.persist !== false;
      let stored: unknown = null,
        notice = "";
      try {
        await writing?.catch(() => undefined);
        if (options.recover) stored = await storage.read();
        else if (options.clear !== false && persist) await storage.write(null);
      } catch {
        notice =
          "The device draft could not be recovered or cleared. Your saved work is unchanged.";
      }
      if (attempt !== version) return null;
      baseline = copy(saved);
      current = copy(saved);
      pending = undefined;
      if (stored) {
        const draft = stored as Draft<T>;
        if (
          draft.version !== 1 ||
          !compatible(draft.baseline, saved) ||
          !compatible(draft.value, saved)
        ) {
          notice = "The device draft is incompatible. Your latest saved work is shown.";
        } else if (!same(draft.value, saved) && !same(draft.value, draft.baseline)) {
          if (same(draft.baseline, saved)) {
            current = copy(draft.value);
            notice = "Unsaved draft restored from this device.";
          } else {
            pending = copy(draft.value);
            notice =
              "Saved work changed since this draft was written. The latest saved version is shown. Restore the draft only if you want to replace these fields, then review before saving.";
          }
        }
      }
      opened = true;
      return { value: copy(current), pending: pending !== undefined, notice };
    },
    update(value: T) {
      if (opened && pending === undefined) current = copy(value);
    },
    markSaved(saved: T) {
      baseline = copy(saved);
      pending = undefined;
    },
    async flush() {
      if (!opened || !persist || pending !== undefined) return;
      await writeLatest(
        same(current, baseline)
          ? null
          : { version: 1, baseline: copy(baseline), value: copy(current) },
      );
    },
    chooseRecovered(restore: boolean) {
      current = copy(restore && pending !== undefined ? pending : baseline);
      pending = undefined;
      return copy(current);
    },
    close() {
      version++;
    },
  };
}

import { createSerialQueue } from "../shared/serial-queue";

export function createDeviceRegistrationStore(storage: {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  remove(): Promise<void>;
}) {
  const serialize = createSerialQueue();
  return {
    register(
      token: string,
      register: (token: string) => Promise<unknown>,
      isCurrent: () => boolean,
    ) {
      return serialize(async () => {
        if (!isCurrent()) throw new Error("Your sign-in changed. Enable push notifications again.");
        // Retain the token before a request with an uncertain outcome, so a
        // following sign-out can still unregister it. Nothing is sent if storage fails.
        await storage.write(token);
        if (!isCurrent()) throw new Error("Your sign-in changed. Enable push notifications again.");
        await register(token);
      });
    },
    unregister(unregister: (token: string) => Promise<unknown>) {
      return serialize(async () => {
        const token = await storage.read();
        if (token) await unregister(token);
        await storage.remove();
      });
    },
  };
}

export type PushRegistration = { token: string; userId: string; cleanupToken?: string };
type PushState = { current?: PushRegistration; pending: PushRegistration[] };

export function createPushCleanupStore(storage: {
  read(): Promise<PushState | null>;
  write(state: PushState): Promise<void>;
}) {
  const serialize = createSerialQueue();
  const load = async () => (await storage.read()) || { pending: [] };
  async function flush(state: PushState, revoke: (entry: PushRegistration) => Promise<unknown>) {
    for (const entry of [...state.pending]) {
      try {
        await revoke(entry);
      } catch {
        continue;
      }
      state.pending = state.pending.filter((item) => item !== entry);
      await storage.write(state);
    }
  }
  return {
    register(
      token: string,
      userId: string,
      prepare: (token: string) => Promise<{ cleanupToken: string }>,
      activate: (token: string, cleanupToken: string) => Promise<unknown>,
      isCurrent: () => boolean,
    ) {
      return serialize(async () => {
        if (!isCurrent()) throw new Error("Your sign-in changed. Enable push again.");
        const state = await load();
        const prepared = await prepare(token);
        const entry = { token, userId, cleanupToken: prepared.cleanupToken };
        if (state.current && (state.current.cleanupToken || state.current.token !== token))
          state.pending.push(state.current);
        state.current = entry;
        await storage.write(state);
        if (!isCurrent()) throw new Error("Your sign-in changed. Enable push again.");
        await activate(token, entry.cleanupToken);
      });
    },
    unregister(userId: string | undefined, revoke: (entry: PushRegistration) => Promise<unknown>) {
      return serialize(async () => {
        const state = await load();
        if (state.current) {
          state.pending.push({ ...state.current, userId: state.current.userId || userId || "" });
          state.current = undefined;
          // The old current record still contains the cleanup proof if storage is full.
          // Try network revocation now and recover the orphaned record on the next retry.
          await storage.write(state).catch(() => undefined);
        }
        await flush(state, revoke);
      });
    },
    retry(revoke: (entry: PushRegistration) => Promise<unknown>, userId?: string) {
      return serialize(async () => {
        const state = await load();
        if (state.current?.userId && state.current.userId !== userId) {
          state.pending.push(state.current);
          state.current = undefined;
          await storage.write(state).catch(() => undefined);
        }
        await flush(state, revoke);
      });
    },
    legacyToken() {
      return serialize(async () => {
        const state = await load();
        return state.current && !state.current.cleanupToken ? state.current.token : null;
      });
    },
  };
}

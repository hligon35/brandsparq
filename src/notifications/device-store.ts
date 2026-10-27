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
        try {
          if (token) await unregister(token);
        } finally {
          await storage.remove();
        }
      });
    },
  };
}

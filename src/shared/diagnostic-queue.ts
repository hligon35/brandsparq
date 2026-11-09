import { sanitizeClientDiagnostic, type ClientDiagnostic } from "./client-diagnostic";
export type DiagnosticEntry = {
  id: string;
  owner: string;
  time: number;
  diagnostic: ClientDiagnostic;
};
export function createDiagnosticQueue(
  storage: {
    read(): Promise<DiagnosticEntry[] | null>;
    write(value: DiagnosticEntry[]): Promise<void>;
  },
  now = () => Date.now(),
) {
  let pending = Promise.resolve();
  function serialize(task: () => Promise<void>) {
    const result = pending.catch(() => undefined).then(task);
    pending = result;
    return result;
  }
  async function read() {
    const saved = await storage.read();
    return (Array.isArray(saved) ? saved : [])
      .filter(
        (row) =>
          row &&
          typeof row.owner === "string" &&
          typeof row.id === "string" &&
          Number.isFinite(row.time) &&
          row.time <= now() &&
          now() - row.time < 7 * 86400000 &&
          sanitizeClientDiagnostic(row.diagnostic),
      )
      .slice(-10)
      .map((row) => ({ ...row, diagnostic: sanitizeClientDiagnostic(row.diagnostic)! }));
  }
  return {
    add(owner: string, diagnostic: ClientDiagnostic) {
      return serialize(async () => {
        const rows = await read();
        rows.push({
          id: `${now()}-${Math.random().toString(36).slice(2)}`,
          owner,
          time: now(),
          diagnostic,
        });
        await storage.write(rows.slice(-10));
      });
    },
    flush(
      owner: string,
      current: () => boolean,
      send: (value: ClientDiagnostic) => Promise<unknown>,
    ) {
      return serialize(async () => {
        let rows = await read();
        await storage.write(rows);
        for (const entry of rows.filter((row) => row.owner === owner)) {
          if (!current()) return;
          try {
            await send(entry.diagnostic);
          } catch {
            return;
          }
          rows = rows.filter((row) => row.id !== entry.id);
          await storage.write(rows);
        }
      });
    },
  };
}

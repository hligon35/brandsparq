import Constants from "expo-constants";
import { Platform } from "react-native";
import { readDraft, saveDraft } from "@/shared/draft-storage";
import {
  clientDiagnostic,
  installRuntimeHandler,
  type ClientDiagnostic,
} from "@/shared/client-diagnostic";
import { createDiagnosticQueue, type DiagnosticEntry } from "@/shared/diagnostic-queue";
const key = "brandsparq_runtime_diagnostics_v1";
const queue = createDiagnosticQueue({
  read: () => readDraft<DiagnosticEntry[]>(key).catch(() => null),
  write: (rows) => saveDraft(key, rows),
});
let session:
  | { owner: string; current(): boolean; send(value: ClientDiagnostic): Promise<unknown> }
  | undefined;
let reports = 0;
export function bindRuntimeDiagnostics(value: NonNullable<typeof session>) {
  session = value;
  reports = 0;
  return () => {
    if (session === value) session = undefined;
  };
}
export function flushRuntimeDiagnostics() {
  const captured = session;
  return captured && captured.current()
    ? queue.flush(captured.owner, captured.current, captured.send).catch(() => undefined)
    : Promise.resolve();
}
export function reportRuntimeError(
  error: unknown,
  source: ClientDiagnostic["source"],
  fatal: boolean,
) {
  const captured = session;
  if (!captured || !captured.current() || reports++ >= 10) return;
  const diagnostic = clientDiagnostic(
    error,
    source,
    fatal,
    Platform.OS,
    Constants.expoConfig?.version,
    Constants.manifest2?.id,
  );
  void queue
    .add(captured.owner, diagnostic)
    .then(() => flushRuntimeDiagnostics())
    .catch(() => undefined);
}
export function installRuntimeDiagnostics() {
  const target = (
    globalThis as typeof globalThis & { ErrorUtils?: Parameters<typeof installRuntimeHandler>[0] }
  ).ErrorUtils;
  return installRuntimeHandler(target, (error, fatal) =>
    reportRuntimeError(error, "runtime", fatal),
  );
}

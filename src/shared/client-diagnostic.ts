const codes = [
  "TYPE_ERROR",
  "REFERENCE_ERROR",
  "RANGE_ERROR",
  "SYNTAX_ERROR",
  "RENDER_ERROR",
  "UNKNOWN_ERROR",
] as const;
export type ClientDiagnostic = {
  code: (typeof codes)[number];
  source: "render" | "runtime";
  fatal: boolean;
  platform: "ios" | "android" | "web" | "unknown";
  version: string;
  updateId: string;
  frames: Array<{ line: number; column: number }>;
};
/** Closed fields only: no messages, component names, URLs, paths, captions or credentials. */
export function sanitizeClientDiagnostic(value: unknown): ClientDiagnostic | null {
  const input = value as Partial<ClientDiagnostic> | null;
  if (
    !input ||
    !codes.includes(input.code as any) ||
    !["render", "runtime"].includes(input.source || "")
  )
    return null;
  return {
    code: input.code!,
    source: input.source!,
    fatal: input.fatal === true,
    platform: ["ios", "android", "web"].includes(input.platform || "")
      ? input.platform!
      : "unknown",
    version:
      typeof input.version === "string" && /^\d{1,4}(\.\d{1,4}){0,3}$/.test(input.version)
        ? input.version
        : "unknown",
    updateId:
      typeof input.updateId === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.updateId)
        ? input.updateId
        : "embedded",
    frames: Array.isArray(input.frames)
      ? input.frames
          .slice(0, 8)
          .flatMap((frame) =>
            frame &&
            Number.isInteger(frame.line) &&
            frame.line > 0 &&
            frame.line < 100000000 &&
            Number.isInteger(frame.column) &&
            frame.column >= 0 &&
            frame.column < 100000000
              ? [{ line: frame.line, column: frame.column }]
              : [],
          )
      : [],
  };
}
export function clientDiagnostic(
  error: unknown,
  source: ClientDiagnostic["source"],
  fatal: boolean,
  platform: string,
  version?: string,
  updateId?: string | null,
): ClientDiagnostic {
  const value = error as { name?: string; stack?: string };
  const names: Record<string, ClientDiagnostic["code"]> = {
    TypeError: "TYPE_ERROR",
    ReferenceError: "REFERENCE_ERROR",
    RangeError: "RANGE_ERROR",
    SyntaxError: "SYNTAX_ERROR",
  };
  // Only bundle coordinates are useful without uploading source paths or error text.
  const frames =
    typeof value?.stack === "string"
      ? value.stack
          .slice(0, 32000)
          .split("\n")
          .slice(1, 30)
          .flatMap((line) => {
            const match = line.match(
              /(?:index\.bundle|main\.jsbundle|\/entry-[a-f0-9]+\.js)(?:\?[^\s)]*)?:(\d+):(\d+)\)?$/,
            );
            return match ? [{ line: Number(match[1]), column: Number(match[2]) }] : [];
          })
      : [];
  return sanitizeClientDiagnostic({
    code:
      source === "render"
        ? "RENDER_ERROR"
        : Object.hasOwn(names, value?.name || "")
          ? names[value.name!]
          : "UNKNOWN_ERROR",
    source,
    fatal,
    platform,
    version,
    updateId,
    frames,
  })!;
}
export function installRuntimeHandler(
  target:
    | {
        getGlobalHandler?(): ((error: unknown, fatal?: boolean) => void) | undefined;
        setGlobalHandler?(handler: (error: unknown, fatal?: boolean) => void): void;
      }
    | undefined,
  report: (error: unknown, fatal: boolean) => void,
) {
  const previous = target?.getGlobalHandler?.();
  if (!target?.setGlobalHandler || !previous) return () => {};
  const handler = (error: unknown, fatal?: boolean) => {
    try {
      report(error, fatal === true);
    } catch {
      /* Diagnostics cannot replace the original failure. */
    }
    previous(error, fatal);
  };
  target.setGlobalHandler(handler);
  return () => {
    if (target.getGlobalHandler?.() === handler) target.setGlobalHandler?.(previous);
  };
}

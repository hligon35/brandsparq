export type RequestPolicy = { timeoutMs?: number; retries?: number };

export class RequestError extends Error {
  constructor(
    message: string,
    public code: "TIMEOUT" | "ABORTED" | "NETWORK" | "HTTP" | "INVALID_RESPONSE",
    public status?: number,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

// The deadline includes body consumption. Some native transports do not reject
// promptly on abort, so race the entire operation as well as aborting fetch.
export async function readResponse<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  read: (response: Response) => Promise<T>,
  { timeoutMs = 15000, fetcher = fetch }: RequestPolicy & { fetcher?: typeof fetch } = {},
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectDeadline: (error: Error) => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
    timer = setTimeout(() => {
      reject(new RequestError("The request took too long. Please try again.", "TIMEOUT"));
      controller.abort();
    }, timeoutMs);
  });
  const cancel = () => {
    rejectDeadline(new RequestError("The request was canceled.", "ABORTED"));
    controller.abort();
  };
  init?.signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (init?.signal?.aborted) cancel();
    const operation = async () => {
      if (controller.signal.aborted) throw new RequestError("The request was canceled.", "ABORTED");
      const response = await fetcher(input, { ...init, signal: controller.signal });
      if (controller.signal.aborted) throw new RequestError("The request was canceled.", "ABORTED");
      return read(response);
    };
    return await Promise.race([deadline, operation()]);
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", cancel);
  }
}

export function createApiTransport(
  baseUrl: string,
  fetcher: typeof fetch = (...args) => fetch(...args),
) {
  let token: string | null = null;
  let revision = 0;
  let unauthorized: (() => void | Promise<void>) | null = null;
  const headers = (extra?: HeadersInit) => {
    const result = new Headers(extra);
    if (token && !result.has("authorization")) result.set("authorization", `Bearer ${token}`);
    return result;
  };
  return {
    headers,
    captureSession() {
      const captured = revision;
      return { headers: headers(), isCurrent: () => token !== null && captured === revision };
    },
    setToken(next: string | null) {
      token = next;
      revision++;
    },
    setUnauthorizedHandler(handler: typeof unauthorized) {
      unauthorized = handler;
    },
    async json<T>(path: string, init?: RequestInit, policy: RequestPolicy = {}): Promise<T> {
      const requestRevision = revision;
      const requestHeaders = headers(init?.headers);
      if (typeof init?.body === "string" && !requestHeaders.has("content-type"))
        requestHeaders.set("content-type", "application/json");
      const method = (init?.method || "GET").toUpperCase();
      // Mutations are never replayed automatically; callers retain their durable IDs.
      const retries = method === "GET" ? (policy.retries ?? 1) : 0;
      for (let attempt = 0; ; attempt++) {
        try {
          return await readResponse(
            baseUrl + path,
            { ...init, headers: requestHeaders },
            async (response) => {
              if (
                response.status === 401 &&
                token !== null &&
                requestRevision === revision &&
                requestHeaders.get("authorization") === (token ? `Bearer ${token}` : null) &&
                !path.startsWith("/v1/public/") &&
                path !== "/v1/auth/google/complete"
              )
                await unauthorized?.();
              if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new RequestError(
                  payload?.error || `Request failed: ${response.status}`,
                  "HTTP",
                  response.status,
                );
              }
              try {
                return (await response.json()) as T;
              } catch {
                throw new RequestError(
                  "The server returned an unreadable response. Please try again.",
                  "INVALID_RESPONSE",
                );
              }
            },
            { ...policy, fetcher },
          );
        } catch (error) {
          if (
            attempt >= retries ||
            init?.signal?.aborted ||
            requestRevision !== revision ||
            (error instanceof RequestError && error.code !== "TIMEOUT" && error.code !== "NETWORK")
          )
            throw error instanceof RequestError
              ? error
              : new RequestError(
                  "Unable to connect. Check your connection and try again.",
                  "NETWORK",
                );
        }
      }
    },
  };
}

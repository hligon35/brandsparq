import { readResponse } from "../../src/api/transport";
// Bound headers and body consumption, including transports that ignore abort.
export function providerFetch(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 30000) {
  return readResponse(
    input,
    init,
    async (response) => {
      const limit = 32 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > limit)
        throw new Error("Provider response exceeds 32 MB.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader)
        try {
          while (true) {
            const result = await reader.read();
            if (result.done) break;
            size += result.value.length;
            if (size > limit) {
              await reader.cancel();
              throw new Error("Provider response exceeds 32 MB.");
            }
            chunks.push(result.value);
          }
        } finally {
          reader.releaseLock();
        }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const body = [204, 205, 304].includes(response.status) ? null : bytes;
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
    { timeoutMs },
  );
}

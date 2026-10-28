import { readResponse } from "../../src/api/transport";
// Bound headers and body consumption, including transports that ignore abort.
export function providerFetch(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 30000) {
  return readResponse(
    input,
    init,
    async (response) => {
      const body = [204, 205, 304].includes(response.status) ? null : await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
    { timeoutMs },
  );
}

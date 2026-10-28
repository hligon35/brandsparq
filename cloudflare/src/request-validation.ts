import { readUpload, UploadError } from "./upload-validation";
const strings = new Set([
  "name",
  "email",
  "timezone",
  "title",
  "headline",
  "caption",
  "comment",
  "instruction",
  "objective",
  "reason",
  "accountId",
  "clientId",
  "mode",
  "requestKey",
  "role",
  "voice",
  "audience",
]);
export async function validatedRequest(request: Request) {
  if (!request.body || new URL(request.url).pathname.includes("webhook")) return request;
  if (
    !["POST", "PATCH", "PUT"].includes(request.method) ||
    !request.headers.get("content-type")?.includes("application/json")
  )
    return request;
  const bytes = await readUpload(request, 256 * 1024);
  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new UploadError("Invalid JSON request.", 400);
  }
  if (!payload || Array.isArray(payload) || typeof payload !== "object")
    throw new UploadError("Expected a JSON object.", 400);
  for (const [key, value] of Object.entries(payload)) {
    if (strings.has(key) && value !== undefined && value !== null && typeof value !== "string")
      throw new UploadError(`${key} must be text.`, 400);
    if (typeof value === "string" && value.length > 70000)
      throw new UploadError(`${key} is too long.`, 400);
  }
  return new Request(request, { body: JSON.stringify(payload) });
}

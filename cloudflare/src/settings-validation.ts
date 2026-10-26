export function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value !== value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validateSettings(payload: unknown): string | null {
  if (!record(payload)) return "Settings must be an object.";
  for (const section of ["workspace", "notifications"])
    if (payload[section] !== undefined && !record(payload[section]))
      return `${section} must be an object.`;
  const w = (payload.workspace || {}) as Record<string, unknown>;
  const n = (payload.notifications || {}) as Record<string, unknown>;
  if (w.timezone !== undefined && !validTimezone(w.timezone))
    return "A valid IANA time zone is required.";
  for (const [object, key, min, max] of [
    [w, "defaultPrepublishMinutes", 1, 10080],
    [w, "minPostSpacingMinutes", 1, 1440],
    [w, "maxPostsPerDay", 1, 100],
    [w, "analyticsRefreshHours", 1, 168],
    [n, "prepublishMinutes", 1, 10080],
  ] as const) {
    const value = object[key];
    if (
      value !== undefined &&
      (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    )
      return `${key} must be a whole number between ${min} and ${max}.`;
  }
  for (const [object, key] of [
    [w, "defaultNoResponsePolicy"],
    [n, "noResponsePolicy"],
  ] as const)
    if (
      object[key] !== undefined &&
      !["auto_publish", "hold", "skip"].includes(object[key] as string)
    )
      return `${key} must be auto_publish, hold, or skip.`;
  const windowPattern = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
  for (const key of ["preferredWindows", "blackoutWindows"]) {
    const windows = w[key];
    if (
      windows !== undefined &&
      (!Array.isArray(windows) ||
        windows.length > 24 ||
        windows.some(
          (value) =>
            typeof value !== "string" ||
            !windowPattern.test(value) ||
            value.slice(0, 5) === value.slice(6),
        ))
    )
      return `${key} must contain up to 24 HH:mm-HH:mm ranges with different start and end times.`;
  }
  for (const key of [
    "emailEnabled",
    "pushEnabled",
    "inAppEnabled",
    "reviewEmailEnabled",
    "reviewReadyEnabled",
    "prepublishEnabled",
    "publishSuccessEnabled",
    "publishFailureEnabled",
  ])
    if (n[key] !== undefined && typeof n[key] !== "boolean") return `${key} must be a boolean.`;
  return null;
}

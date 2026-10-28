export function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
export const revisionRequired = {
  status: 428,
  body: {
    error:
      "Update the app or reload the web page before saving. This version cannot protect your changes.",
  },
};
export const revisionConflict = {
  status: 409,
  body: {
    error:
      "This work changed in another session. Your edits are still here. Reload the latest version before saving again.",
  },
};

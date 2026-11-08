export const REVIEW_COPY_STATUSES = ["awaiting_approval", "edit_requested"] as const;
export const SCHEDULED_COPY_STATUSES = [
  "calendar_scheduled",
  "rescheduled",
  "pre_publish",
] as const;
export const reviewCopyEditable = (status: string) =>
  REVIEW_COPY_STATUSES.some((value) => value === status);
export const scheduledCopyEditable = (status: string) =>
  SCHEDULED_COPY_STATUSES.some((value) => value === status);

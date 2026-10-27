export type UploadItem<T> = {
  key: string;
  source: T;
  originalId?: string;
  status: "pending" | "uploading" | "ready" | "failed";
  error?: string;
};
// Wait for every worker, retain successes and original IDs after derivative
// failures, and retry only incomplete items. The caller owns the client snapshot.
export async function uploadBatch<T>(
  items: UploadItem<T>[],
  upload: (item: UploadItem<T>, index: number) => Promise<void>,
  changed: () => void,
) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++,
        item = items[index];
      if (item.status === "ready") continue;
      item.status = "uploading";
      item.error = undefined;
      changed();
      try {
        await upload(item, index);
        item.status = "ready";
      } catch (error) {
        item.status = "failed";
        item.error = error instanceof Error ? error.message : "Upload failed. Retry this image.";
      }
      changed();
    }
  }
  await Promise.allSettled(Array.from({ length: Math.min(3, items.length) }, worker));
  if (items.some((item) => item.status !== "ready"))
    throw new Error(
      "Some images could not be uploaded. Retry failed images or remove them; completed uploads are saved.",
    );
}

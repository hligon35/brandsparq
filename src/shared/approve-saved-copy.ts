export async function approveSavedCopy(
  revision: number,
  approve: (revision: number) => Promise<unknown>,
  read: () => Promise<{ revision?: number; approvedAt?: string; status: string }>,
) {
  try {
    await approve(revision);
  } catch (error) {
    // A lost response is not a failed approval. Confirm the exact saved copy before retrying.
    const current = await read().catch(() => null);
    if (
      !current ||
      current.revision !== revision ||
      !current.approvedAt ||
      ![
        "calendar_scheduled",
        "rescheduled",
        "pre_publish",
        "publish_queued",
        "publishing",
        "provider_processing",
        "published",
      ].includes(current.status)
    )
      throw error;
  }
}

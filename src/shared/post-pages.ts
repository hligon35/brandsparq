// Drain bounded API pages for existing callers that require a complete list.
export async function collectPostPages<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<{ data: T[]; nextCursor?: string | null }>,
) {
  const rows = new Map<string, T>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    for (const row of page.data) rows.set(row.id, row);
    if (!page.nextCursor) return [...rows.values()];
    if (seen.has(page.nextCursor))
      throw new Error("The post list changed unexpectedly. Refresh to retry.");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);
  return [...rows.values()];
}

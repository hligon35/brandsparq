// Refresh the visible window from current server membership. Old rows that no
// longer match a filter disappear, while previously loaded pages stay reachable.
export async function refreshPages<T>(
  first: { data: T[]; nextCursor: string | null },
  visibleCount: number,
  fetchPage: (cursor: string) => Promise<{ data: T[]; nextCursor: string | null }>,
  pageSize = 50,
) {
  const result = { data: [...first.data], nextCursor: first.nextCursor };
  const pages = Math.max(1, Math.ceil(visibleCount / pageSize));
  for (let i = 1; i < pages && result.nextCursor; i++) {
    const next = await fetchPage(result.nextCursor);
    result.data.push(...next.data);
    result.nextCursor = next.nextCursor;
  }
  return result;
}

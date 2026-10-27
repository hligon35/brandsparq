export function pageOptions(url: URL, defaultLimit = 50) {
  const limit = Number(url.searchParams.get("limit") || defaultLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Page size must be between 1 and 100.");
  const search = (url.searchParams.get("search") || "").trim();
  if (search.length > 200) throw new Error("Search must be 200 characters or fewer.");
  let cursor: { createdAt: string; id: string } | null = null;
  const encoded = url.searchParams.get("cursor");
  if (encoded) {
    try {
      if (encoded.length > 1024) throw new Error();
      cursor = JSON.parse(atob(encoded));
      if (
        !cursor ||
        typeof cursor.id !== "string" ||
        !cursor.id ||
        cursor.id.length > 128 ||
        typeof cursor.createdAt !== "string" ||
        !Number.isFinite(Date.parse(cursor.createdAt))
      )
        throw new Error();
    } catch {
      throw new Error("Invalid page cursor.");
    }
  }
  return { limit, search, cursor };
}
export function pageResult<T extends { id: string; created_at: string }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit),
    last = data[data.length - 1];
  return {
    data,
    nextCursor:
      rows.length > limit && last
        ? btoa(JSON.stringify({ createdAt: last.created_at, id: last.id }))
        : null,
  };
}

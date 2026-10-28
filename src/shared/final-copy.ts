export function renderFinalCopy(caption: string, hashtags: unknown): string {
  let tags: unknown = hashtags;
  if (typeof tags === "string") {
    try {
      tags = JSON.parse(tags);
    } catch {
      tags = [];
    }
  }
  const seen = new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()));
  const extra: string[] = [];
  for (const value of Array.isArray(tags) ? tags : []) {
    if (typeof value !== "string") continue;
    const tag = "#" + value.trim().replace(/^#+/, "");
    if (!/^#[\p{L}\p{N}_]+$/u.test(tag) || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    extra.push(tag);
  }
  return caption + (extra.length ? (caption ? "\n\n" : "") + extra.join(" ") : "");
}
// Conservative standard-post X budget: URL tokens cost 23; emoji clusters and
// non-Latin characters cost two. Never truncate approved text to fit a budget.
export function copyLength(platform: string, text: string) {
  if (platform !== "x") return Array.from(text).length;
  const chunks = text.split(/(https?:\/\/[^\s]+)/g);
  const segmenter =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter("en", { granularity: "grapheme" })
      : { segment: (value: string) => Array.from(value).map((segment) => ({ segment })) };
  return chunks.reduce(
    (sum, chunk) =>
      sum +
      (/^https?:\/\//.test(chunk)
        ? 23
        : Array.from(segmenter.segment(chunk)).reduce(
            (n, { segment }) =>
              n +
              (/\p{Extended_Pictographic}/u.test(segment)
                ? 2
                : Array.from(segment).reduce(
                    (m, c) => m + (c.codePointAt(0)! <= 0x10ff ? 1 : 2),
                    0,
                  )),
            0,
          )),
    0,
  );
}
export function finalCopyError(platform: string, text: string) {
  const limit: Record<string, number> = {
    x: 280,
    instagram: 2200,
    tiktok: 2200,
    linkedin: 3000,
    facebook: 63206,
  };
  if (!text.trim()) return "Add publication copy before approving.";
  const count = copyLength(platform, text);
  return count > (limit[platform] ?? 2200)
    ? `This ${platform} copy uses ${count} characters; the limit is ${limit[platform] ?? 2200}. Shorten the caption or hashtags before approving.`
    : null;
}

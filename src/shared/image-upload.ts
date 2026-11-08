export function imageUploadType(blobType: string, hint: string) {
  return blobType.toLowerCase().startsWith("image/")
    ? blobType
    : hint.toLowerCase().startsWith("image/")
      ? hint
      : "application/octet-stream";
}
export function prominentColors(data: ArrayLike<number>, channels: number, depth = 8): string[] {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  if (![1, 2, 3, 4].includes(channels)) return [];
  // Bound palette work even for large source photos; preserve 16-bit PNG colors.
  const scale = depth === 16 ? 257 : 1;
  const stride = Math.max(1, Math.ceil(data.length / channels / 12000)) * channels;
  for (let i = 0; i < data.length; i += stride) {
    if (
      (channels === 4 && data[i + 3] / scale < 128) ||
      (channels === 2 && data[i + 1] / scale < 128)
    )
      continue;
    const r = Math.round(data[i] / scale),
      g = Math.round((channels < 3 ? data[i] : data[i + 1]) / scale),
      b = Math.round((channels < 3 ? data[i] : data[i + 2]) / scale);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const v = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    v.count++;
    v.r += r;
    v.g += g;
    v.b += b;
    bins.set(key, v);
  }
  const ranked = [...bins.values()]
    .sort((a, b) => b.count - a.count)
    .map((v) => [Math.round(v.r / v.count), Math.round(v.g / v.count), Math.round(v.b / v.count)]);
  const first = ranked[0];
  if (!first) return [];
  const selected = [first];
  for (const candidate of ranked.slice(1)) {
    if (selected.every((color) => candidate.some((n, i) => Math.abs(n - color[i]) > 40)))
      selected.push(candidate);
    if (selected.length === 3) break;
  }
  return selected.map(
    (v) =>
      "#" +
      v
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase(),
  );
}

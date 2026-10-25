export function imageUploadType(blobType: string, hint: string) {
  return blobType.toLowerCase().startsWith("image/")
    ? blobType
    : hint.toLowerCase().startsWith("image/")
      ? hint
      : "application/octet-stream";
}
export function prominentColors(data: ArrayLike<number>, channels: number): string[] {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += channels) {
    if ((channels === 4 && data[i + 3] < 128) || (channels === 2 && data[i + 1] < 128)) continue;
    const r = data[i],
      g = channels < 3 ? data[i] : data[i + 1],
      b = channels < 3 ? data[i] : data[i + 2];
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
  const second = ranked.find((v) => v.some((n, i) => Math.abs(n - first[i]) > 40));
  return [first, second]
    .filter((v): v is number[] => !!v)
    .map(
      (v) =>
        "#" +
        v
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase(),
    );
}

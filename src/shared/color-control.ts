export function colorChannelAt(position: number, width: number) {
  if (!Number.isFinite(position) || !Number.isFinite(width) || width <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, position / width)) * 255);
}

import { decode as decodeJpeg } from "jpeg-js";
import { decode } from "fast-png";
export class UploadError extends Error {
  constructor(
    message: string,
    public status = 415,
  ) {
    super(message);
  }
}
export async function readUpload(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new UploadError("Upload exceeds size limit.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new UploadError("Empty image.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new UploadError("Upload exceeds size limit.", 413);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}
export function inspectImage(buffer: ArrayBuffer, derivative = false) {
  const b = new Uint8Array(buffer),
    v = new DataView(buffer);
  let type = "",
    width = 0,
    height = 0;
  const ascii = (a: number, n: number) => String.fromCharCode(...b.slice(a, a + n));
  if (b.length > 32 && ascii(0, 8) === "\x89PNG\r\n\x1a\n") {
    width = v.getUint32(16);
    height = v.getUint32(20);
    type = "image/png";
    if (width * height > 24000000) throw new UploadError("Image exceeds 24 million pixels.");
    try {
      decode(b, { checkCrc: true });
    } catch {
      throw new UploadError("Corrupt PNG image.");
    }
  } else if (
    b.length > 12 &&
    b[0] === 255 &&
    b[1] === 216 &&
    b[b.length - 2] === 255 &&
    b[b.length - 1] === 217
  ) {
    type = "image/jpeg";
    let i = 2,
      sawScan = false;
    while (i < b.length - 2) {
      if (b[i++] !== 255) throw new UploadError("Corrupt JPEG marker.");
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 217) break;
      if (marker === 218) {
        sawScan = true;
        break;
      }
      if (i + 2 > b.length) throw new UploadError("Truncated JPEG.");
      const size = v.getUint16(i);
      if (size < 2 || i + size > b.length) throw new UploadError("Truncated JPEG segment.");
      if ([192, 193, 194].includes(marker)) {
        if (size < 8) throw new UploadError("Invalid JPEG dimensions.");
        height = v.getUint16(i + 3);
        width = v.getUint16(i + 5);
      }
      i += size;
    }
    if (!sawScan) throw new UploadError("JPEG scan missing.");
  }
  if (!type || !width || !height || width > 16384 || height > 16384 || width * height > 24000000)
    throw new UploadError(
      "Unsupported or malformed image; use a valid PNG or JPEG under 24 million pixels. Convert other formats to JPEG before uploading.",
    );
  if (derivative && type !== "image/jpeg")
    throw new UploadError("Analysis and thumbnail derivatives must be JPEG.");
  if (type === "image/jpeg")
    try {
      decodeJpeg(b, {
        useTArray: true,
        tolerantDecoding: false,
        maxResolutionInMP: 24,
        maxMemoryUsageInMB: 96,
      });
    } catch {
      throw new UploadError("Corrupt JPEG image or decoding memory limit exceeded.");
    }
  return { type, width, height };
}

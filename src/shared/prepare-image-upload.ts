export type UploadImage = {
  uri: string;
  filename: string;
  contentType: string;
  width?: number;
  height?: number;
};
type ImageAdapter = {
  dimensions(uri: string): Promise<{ width: number; height: number }>;
  resize(
    uri: string,
    edge: number,
    format: "png" | "jpeg",
    dimensions: { width: number; height: number },
  ): Promise<{ uri: string; width: number; height: number }>;
  blob(uri: string): Promise<Blob>;
};
/** Bound the uploaded image itself, including HEIC conversions; preserve PNG transparency. */
export async function prepareImageUpload(image: UploadImage, adapter: ImageAdapter) {
  const dimensions =
    image.width && image.height
      ? { width: image.width, height: image.height }
      : await adapter.dimensions(image.uri);
  if (
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  )
    throw new Error("Unable to read image dimensions. Choose this image again.");
  const format = image.contentType.toLowerCase() === "image/png" ? "png" : "jpeg";
  for (const edge of [2000, 1200]) {
    const prepared = await adapter.resize(image.uri, edge, format, dimensions);
    if (Math.max(prepared.width, prepared.height) > edge)
      throw new Error("Image could not be resized safely.");
    const blob = await adapter.blob(prepared.uri);
    if (blob.size <= 8 * 1024 * 1024)
      return {
        ...prepared,
        blob,
        contentType: `image/${format}`,
        filename: image.filename.replace(/\.[^.]+$/, "") + (format === "png" ? ".png" : ".jpg"),
      };
  }
  throw new Error("This image is too large to upload. Choose a smaller image.");
}

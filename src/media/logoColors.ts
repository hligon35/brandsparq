import * as ImageManipulator from "expo-image-manipulator";
import { decode } from "fast-png";
import { prominentColors } from "@/shared/image-upload";
export async function logoColors(uri: string) {
  const image = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 96 } }], {
    format: ImageManipulator.SaveFormat.PNG,
    base64: true,
  });
  const pixels = decode(Uint8Array.from(atob(image.base64!), (c) => c.charCodeAt(0)));
  return prominentColors(pixels.data, pixels.channels);
}

import { Image } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { prepareImageUpload, type UploadImage } from "@/shared/prepare-image-upload";
import { readResponse } from "@/api/transport";
import { createSerialQueue } from "@/shared/serial-queue";

// A phone processes one full-size source at a time, including conversion and Blob creation.
const serialize = createSerialQueue();
export const prepareUpload = (image: UploadImage) =>
  serialize(() =>
    prepareImageUpload(image, {
      dimensions: (uri) =>
        new Promise((resolve, reject) =>
          Image.getSize(uri, (width, height) => resolve({ width, height }), reject),
        ),
      resize: (uri, edge, format, dimensions) =>
        ImageManipulator.manipulateAsync(
          uri,
          Math.max(dimensions.width, dimensions.height) > edge
            ? [
                {
                  resize:
                    dimensions.width >= dimensions.height ? { width: edge } : { height: edge },
                },
              ]
            : [],
          {
            format:
              format === "png" ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG,
            compress: 0.85,
          },
        ),
      blob: (uri) =>
        readResponse(uri, undefined, async (response) => {
          if (!response.ok) throw new Error("Unable to read this image. Choose it again.");
          return response.blob();
        }),
    }),
  );

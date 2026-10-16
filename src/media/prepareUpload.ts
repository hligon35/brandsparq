import * as ImageManipulator from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";

export type PreparedCampaignAsset = {
  original: ImagePickerAsset;
  analysisUri: string;
  analysisFilename: string;
  analysisMimeType: string;
  analysisWidth?: number;
  analysisHeight?: number;
};

const MAX_ANALYSIS_EDGE = 2000;

export async function prepareCampaignAsset(
  asset: ImagePickerAsset,
  index: number,
): Promise<PreparedCampaignAsset> {
  const width = asset.width || 0;
  const height = asset.height || 0;
  const largest = Math.max(width, height);

  const actions: ImageManipulator.Action[] = [];
  if (largest > MAX_ANALYSIS_EDGE && width > 0 && height > 0) {
    if (width >= height) {
      actions.push({ resize: { width: MAX_ANALYSIS_EDGE } });
    } else {
      actions.push({ resize: { height: MAX_ANALYSIS_EDGE } });
    }
  }

  const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: 0.82,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return {
    original: asset,
    analysisUri: result.uri,
    analysisFilename: `analysis-${index + 1}.jpg`,
    analysisMimeType: "image/jpeg",
    analysisWidth: result.width,
    analysisHeight: result.height,
  };
}

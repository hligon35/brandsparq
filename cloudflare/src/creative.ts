import type { OpenAIEnv } from "./ai/openai";
import { createStructuredResponse } from "./ai/openai";

export type CreativePlatform = "instagram" | "facebook" | "linkedin" | "tiktok" | "x";

export type CreativeProfile = {
  variantKey: string;
  aspectRatio: string;
  width: number;
  height: number;
  imageSize: string;
};

const PLATFORM_PROFILES: Record<CreativePlatform, CreativeProfile> = {
  instagram: {
    variantKey: "feed_portrait",
    aspectRatio: "4:5",
    width: 1024,
    height: 1280,
    imageSize: "1024x1280",
  },
  facebook: {
    variantKey: "feed_portrait",
    aspectRatio: "4:5",
    width: 1024,
    height: 1280,
    imageSize: "1024x1280",
  },
  linkedin: {
    variantKey: "feed_landscape",
    aspectRatio: "3:2",
    width: 1536,
    height: 1024,
    imageSize: "1536x1024",
  },
  tiktok: {
    variantKey: "vertical",
    aspectRatio: "2:3",
    width: 1024,
    height: 1536,
    imageSize: "1024x1536",
  },
  x: {
    variantKey: "feed_landscape",
    aspectRatio: "3:2",
    width: 1536,
    height: 1024,
    imageSize: "1536x1024",
  },
};

export function creativeProfile(platform: CreativePlatform) {
  return PLATFORM_PROFILES[platform];
}

export function deterministicComposition(input: {
  platform: CreativePlatform;
  headline: string;
  cta?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoAssetId?: string | null;
}) {
  const profile = creativeProfile(input.platform);
  return {
    version: 1,
    canvas: {
      width: profile.width,
      height: profile.height,
      aspectRatio: profile.aspectRatio,
    },
    safeArea: {
      left: 0.07,
      right: 0.07,
      top: 0.07,
      bottom: 0.07,
    },
    headline: {
      text: input.headline,
      anchor: input.platform === "tiktok" ? "top_left" : "bottom_left",
      maxWidth: 0.72,
      maxLines: 3,
    },
    cta: input.cta
      ? {
          text: input.cta,
          anchor: "bottom_left",
          style: "pill",
        }
      : null,
    logo: input.logoAssetId
      ? {
          assetId: input.logoAssetId,
          anchor: "top_right",
          maxWidth: 0.2,
        }
      : null,
    colors: {
      primary: input.primaryColor || "#0B78F6",
      secondary: input.secondaryColor || "#00C9D7",
    },
  };
}

export type SparqScore = {
  overall: number;
  brandMatch: number;
  readability: number;
  platformFit: number;
  ctaStrength: number;
  composition: number;
  captionQuality: number;
  compliance: number;
  rationale: string;
};

const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "overall","brandMatch","readability","platformFit","ctaStrength",
    "composition","captionQuality","compliance","rationale"
  ],
  properties: {
    overall: { type: "integer", minimum: 0, maximum: 100 },
    brandMatch: { type: "integer", minimum: 0, maximum: 100 },
    readability: { type: "integer", minimum: 0, maximum: 100 },
    platformFit: { type: "integer", minimum: 0, maximum: 100 },
    ctaStrength: { type: "integer", minimum: 0, maximum: 100 },
    composition: { type: "integer", minimum: 0, maximum: 100 },
    captionQuality: { type: "integer", minimum: 0, maximum: 100 },
    compliance: { type: "integer", minimum: 0, maximum: 100 },
    rationale: { type: "string" },
  },
};

export async function evaluateCreative(
  env: OpenAIEnv,
  input: {
    platform: CreativePlatform;
    headline: string;
    caption: string;
    hashtags: string[];
    objective: string;
    brandContext: unknown;
    composition: unknown;
    imageUrl?: string;
  }
) {
  const content: Array<
    { type: "input_text"; text: string } |
    { type: "input_image"; image_url: string }
  > = [
    {
      type: "input_text",
      text: [
        "Evaluate this BrandSparQ social post.",
        "Score each category independently from 0 to 100.",
        "Do not reward invented facts or unsupported claims.",
        `Platform: ${input.platform}`,
        `Objective: ${input.objective}`,
        `Headline: ${input.headline}`,
        `Caption: ${input.caption}`,
        `Hashtags: ${JSON.stringify(input.hashtags)}`,
        `Brand context: ${JSON.stringify(input.brandContext)}`,
        `Composition plan: ${JSON.stringify(input.composition)}`,
      ].join("\n"),
    },
  ];

  if (input.imageUrl) {
    content.push({ type: "input_image", image_url: input.imageUrl });
  }

  return createStructuredResponse<SparqScore>(env, {
    instructions:
      "You are BrandSparQ's quality evaluator. Return calibrated scores only from the supplied post, visual, brand rules, platform, and objective.",
    content,
    schemaName: "brandsparq_score",
    schema: SCORE_SCHEMA,
    model: env.OPENAI_FAST_MODEL || "gpt-6-luna",
    reasoningEffort: "low",
  });
}

export type OpenAIImageQuality = "low" | "medium" | "high" | "xhigh" | "max" | "auto";

export type OpenAIEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MODEL?: string;
  OPENAI_FAST_MODEL?: string;
  OPENAI_IMAGE_MODEL?: string;
  OPENAI_IMAGE_EDIT_MODEL?: string;
  OPENAI_IMAGE_QUALITY?: OpenAIImageQuality;
  OPENAI_IMAGE_SIZE?: string;
};

export type InputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

export type OpenAIResult<T> = {
  data: T;
  responseId?: string;
  requestId?: string;
  usage?: unknown;
  model: string;
};

export type OpenAIImageResult = {
  bytes: Uint8Array;
  mimeType: "image/jpeg";
  responseId?: string;
  requestId?: string;
  usage?: unknown;
  model: string;
  imageModel: string;
  revisedPrompt?: string;
};

function requireKey(env: OpenAIEnv) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  return env.OPENAI_API_KEY;
}

async function requestResponses(env: OpenAIEnv, body: Record<string, unknown>) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${requireKey(env)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const requestId = response.headers.get("x-request-id") || undefined;
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenAI request failed (${response.status})${requestId ? ` [${requestId}]` : ""}: ${errorText.slice(0, 800)}`,
    );
  }

  return { payload: await response.json<any>(), requestId };
}

export function extractOutputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function createStructuredResponse<T>(
  env: OpenAIEnv,
  options: {
    instructions: string;
    content: InputContent[];
    schemaName: string;
    schema: Record<string, unknown>;
    model?: string;
    reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  },
): Promise<OpenAIResult<T>> {
  const model = options.model || env.OPENAI_TEXT_MODEL || "gpt-6.1-sol";
  const result = await requestResponses(env, {
    model,
    reasoning: { effort: options.reasoningEffort || "low" },
    instructions: options.instructions,
    input: [{ role: "user", content: options.content }],
    text: {
      format: {
        type: "json_schema",
        name: options.schemaName,
        strict: true,
        schema: options.schema,
      },
    },
  });

  const text = extractOutputText(result.payload).trim();
  if (!text) throw new Error("OpenAI returned no structured text output.");

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error("OpenAI returned invalid structured JSON.");
  }

  return {
    data,
    responseId: result.payload?.id,
    requestId: result.requestId,
    usage: result.payload?.usage,
    model,
  };
}

export async function createImageResponse(
  env: OpenAIEnv,
  options: {
    instructions: string;
    prompt: string;
    images?: Array<{ type: "input_image"; image_url: string }>;
    action?: "auto" | "generate" | "edit";
    imageModel?: string;
    quality?: OpenAIImageQuality;
    size?: string;
  },
): Promise<OpenAIImageResult> {
  const model = env.OPENAI_TEXT_MODEL || "gpt-6.1-sol";
  const imageModel =
    options.imageModel ||
    (options.action === "edit"
      ? env.OPENAI_IMAGE_EDIT_MODEL || "gpt-image-2.5-sunburst"
      : env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare");

  const content: InputContent[] = [
    ...(options.images || []),
    { type: "input_text", text: options.prompt },
  ];

  const result = await requestResponses(env, {
    model,
    reasoning: { effort: "low" },
    instructions: options.instructions,
    input: [{ role: "user", content }],
    tools: [
      {
        type: "image_generation",
        model: imageModel,
        action: options.action || "auto",
        quality: options.quality || env.OPENAI_IMAGE_QUALITY || "medium",
        size: options.size || env.OPENAI_IMAGE_SIZE || "1024x1280",
        output_format: "jpeg",
        output_compression: 90,
        background: "opaque",
      },
    ],
    tool_choice: { type: "image_generation" },
  });

  const imageCall = (result.payload?.output || []).find(
    (item: any) => item?.type === "image_generation_call" && typeof item?.result === "string",
  );
  if (!imageCall?.result) throw new Error("OpenAI returned no image generation result.");

  return {
    bytes: base64ToBytes(imageCall.result),
    mimeType: "image/jpeg",
    responseId: result.payload?.id,
    requestId: result.requestId,
    usage: result.payload?.usage,
    model,
    imageModel,
    revisedPrompt:
      typeof imageCall.revised_prompt === "string" ? imageCall.revised_prompt : undefined,
  };
}

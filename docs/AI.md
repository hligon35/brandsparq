# BrandSparQ AI pipeline

BrandSparQ keeps all OpenAI access server-side in the Cloudflare Worker. The Expo app never receives an OpenAI key.

## Model routing

- Campaign planning, brand reasoning, image understanding: gpt-6.1-sol
- Fast caption rewrites: gpt-6-luna
- Standard graphic generation: gpt-image-2.5-flare
- Precise image editing: gpt-image-2.5-sunburst

The Worker uses the OpenAI Responses API. Prompts are versioned in `cloudflare/src/ai/prompts.ts`.

## Setup

From the `cloudflare` directory:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler d1 migrations apply brandsparq --remote
```

Use the BrandSparQ OpenAI project's service-account key. Never create `EXPO_PUBLIC_OPENAI_*` variables.

## Configurable model variables

- `OPENAI_TEXT_MODEL`
- `OPENAI_FAST_MODEL`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_IMAGE_EDIT_MODEL`
- `OPENAI_IMAGE_QUALITY`
- `OPENAI_IMAGE_SIZE`

## Failure behavior

Campaign copy is the primary generation result. If an image render fails, the campaign remains reviewable and the image failure is recorded on the post instead of discarding otherwise valid copy.

## AI routes

Authenticated:
- `POST /v1/generation-jobs`
- `POST /v1/posts/:postId/ai-rewrite-caption`
- `POST /v1/posts/:postId/ai-edit-image`
- `POST /v1/posts/:postId/ai-regenerate`
- `GET /v1/media/:r2Key`

Public review:
- `GET /v1/public/review/:token`
- `GET /v1/public/review/:token/media`

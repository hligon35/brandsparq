# Sprint 3 — Creative Engine

Status: implemented on `main`.

## Implemented

- Preserves original uploads in R2.
- Creates normalized JPEG analysis derivatives on-device with Expo ImageManipulator.
- Stores image dimensions and SHA-256 integrity hashes.
- AI analysis consumes derivatives first and fails clearly when no safe analysis source exists.
- Uploads run with bounded concurrency and visible progress.
- Campaign planning and graphic rendering are split into independent queue jobs.
- Graphic jobs are resumable and independently retryable.
- Review is gated until creative rendering finishes.
- Platform-specific primary creative profiles are stored as `creative_variants`.
- Creative composition contracts define safe areas, headline, CTA, colors, and reserved logo placement.
- Exact uploaded logo assets are supplied as visual references when configured.
- SparQ Score is now a separate evaluation pass after the visual exists.
- Score components include brand match, readability, platform fit, CTA strength, composition, caption quality, and compliance.
- Review UI exposes the component score breakdown.
- Completed graphic retries recover campaign finalization safely.

## Migration

Apply:

```bash
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
```

Sprint 3 adds:

- `0011_sprint3_creative_engine.sql`

## App dependency

Sprint 3 adds Expo ImageManipulator. After pulling:

```bash
npm install
```

Expo SDK 57 uses the `expo-image-manipulator` package for iOS, Android, and web image normalization.

## Storage layout

- `originals/{client}/{asset}.*`
- `derivatives/{client}/{asset}/analysis.jpg`
- `generated/{client}/{post}/{variant}/{version}.jpg`

The original file remains preserved while AI receives the smaller analysis derivative.


## Rendering note

BrandSparQ now persists a deterministic composition contract and supplies the exact uploaded logo as a visual reference. The final raster is still produced by the configured image-generation model.

A Worker-side SVG/PNG compositor was intentionally not added in Sprint 3 because the available WASM rasterizers can materially increase Worker memory usage. Exact server-side text/logo raster compositing should be introduced only with a renderer proven safe under the production Worker memory limit.

# Sprint 2 — Real Production Data

Status: implemented on `main`.

## Implemented

- Replaced hard-coded Home metrics with `GET /v1/dashboard`.
- Removed production demo-data fallbacks.
- Added explicit loading/error/empty states to core workspaces.
- Added client create, update, and archive lifecycle.
- Added client timezone editing.
- Expanded Brand Brain with typography, vocabulary, examples, competitor references, prohibited styles, hashtag policy, target locations, and platform rules.
- Added primary logo, alternate logo, and reference-image asset attachment.
- Wired expanded Brand Brain fields into AI generation context.
- Added client lifecycle and brand-asset D1 schema.
- Removed obsolete `src/data/demo.ts`.
- Removed stale `cloudflare/schema.sql`; migrations are canonical.
- Updated README and production documentation.

## Migration

Apply before deploying:

```bash
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
```

Sprint 2 adds:

- `0010_sprint2_production_data.sql`

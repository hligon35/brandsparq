# BrandSparQ Cloudflare backend

The Cloudflare Worker is the server-side control plane for authentication, D1 persistence, private R2 media, Queues, cron scheduling, AI generation, notifications, social OAuth/publishing, and analytics.

The Expo app is the control surface; scheduling, generation, publishing, auth, notifications, and analytics are server-side.

Implemented:
- Worker API
- D1 migrations
- R2 media storage
- publish and generation Queues
- cron dispatcher
- Google OAuth and RBAC
- AI generation jobs
- signed media delivery
- Resend / Expo notification plumbing
- Meta, LinkedIn, TikTok and X adapters
- client and Brand Brain management

Migrations in `cloudflare/migrations/` are the canonical database schema.

Never place social-provider secrets in `EXPO_PUBLIC_*` variables.

## Local

```bash
npm ci
npx wrangler d1 migrations apply brandsparq --local
npm run dev
```

## Production

Store secrets with `wrangler secret put`; never place provider secrets in `EXPO_PUBLIC_*` variables or commit them to `wrangler.toml`.

Before Worker deployment:

```bash
npx wrangler d1 migrations apply brandsparq --remote
npm run deploy
```

The publish scheduler runs every minute. Analytics sync honors the workspace refresh interval; the additional six-hour cron also wakes the worker. Completed sync timestamps prevent unnecessary provider collection.


## Workers Builds settings

BrandSparQ is a small monorepo: the Expo app is at the repository root and the Worker project (including `wrangler.toml`) is in `cloudflare/`.

Configure Workers Builds like this:

```text
Root directory: /cloudflare
Build command: npm run build
Deploy command: npm run deploy
```

Cloudflare installs the Worker dependencies from `cloudflare/package.json`. The Worker build script then installs the parent Expo app dependencies from the repository root and exports the web app to `../dist`, which matches the assets directory configured in `wrangler.toml`.

# BrandSparQ Cloudflare backend

The Cloudflare Worker is the server-side control plane for authentication, D1 persistence, private R2 media, Queues, cron scheduling, AI generation, notifications, social OAuth/publishing, and analytics.

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

The publish scheduler runs every minute. Analytics has a separate six-hour cron so provider metric collection does not run inside every publishing tick.

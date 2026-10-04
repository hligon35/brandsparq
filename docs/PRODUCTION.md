# BrandSparQ production runbook

Production host: `https://brandsparq.getsparqd.com`

## Cloudflare resources

Create or verify:

- Worker: `brandsparq`
- D1: `brandsparq`
- R2: `brandsparq-media`
- Queue: `brandsparq-publish`
- Queue: `brandsparq-generation`
- Custom domain: `brandsparq.getsparqd.com`

Apply every pending migration before deploying the Worker:

```bash
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
```

## Worker secrets

Required:

```text
AUTH_PEPPER
AUTH_ALLOWED_EMAILS
SOCIAL_TOKEN_KEY

GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_FROM_NAME
REVIEW_NOTIFICATION_EMAIL

OPENAI_API_KEY

META_APP_ID
META_APP_SECRET
META_WEBHOOK_VERIFY_TOKEN

LINKEDIN_CLIENT_ID
LINKEDIN_CLIENT_SECRET

TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET

X_CLIENT_ID
X_CLIENT_SECRET
```

Use a different long random value for `SOCIAL_TOKEN_KEY` than `AUTH_PEPPER`.

## OAuth callback URLs

Google:

```text
https://brandsparq.getsparqd.com/v1/auth/google/callback
```

Meta:

```text
https://brandsparq.getsparqd.com/v1/social/meta/callback
```

LinkedIn:

```text
https://brandsparq.getsparqd.com/v1/social/linkedin/callback
```

TikTok:

```text
https://brandsparq.getsparqd.com/v1/social/tiktok/callback
```

X:

```text
https://brandsparq.getsparqd.com/v1/social/x/callback
```

The corresponding production URLs are already configured in `wrangler.toml`.

## Social publishing behavior

Connected credentials are encrypted before storage in D1 using AES-GCM and `SOCIAL_TOKEN_KEY`.

Posts must have a connected social account assigned before approval/publishing.

Publishing runs through the Cloudflare queue with idempotency protection and up to three provider attempts. Permanent failures move the post to `failed` and generate an owner notification.

Supported publishing adapters:

- Instagram image publishing through Meta
- Facebook Page photo publishing through Meta
- LinkedIn member image posts
- LinkedIn organization image posts when approved organization scopes are configured
- TikTok photo direct posting with provider-status polling
- X image posts

BrandSparQ now distinguishes provider acceptance from confirmed publication. TikTok posts remain in `provider_processing` until the provider confirms completion.

Connected social accounts are health-checked periodically and can also be verified manually from Social Connections.

Meta webhook endpoint:

```text
https://brandsparq.getsparqd.com/v1/social/webhooks/meta
```

Configure the same `META_WEBHOOK_VERIFY_TOKEN` in Meta and the Worker. POST events are validated with Meta's `x-hub-signature-256` signature before storage.

Optional LinkedIn organization publishing requires app approval for organization scopes. Set only scopes your LinkedIn app has actually been granted, for example:

```text
LINKEDIN_ORGANIZATION_SCOPES=w_organization_social r_organization_social
```

Provider app permissions/review requirements still apply. BrandSparQ cannot bypass provider approval or account eligibility requirements.

## Notifications

BrandSparQ delivers:

- review emails
- pre-publish email alerts
- Expo push alerts to registered native devices
- in-app notification records
- publish-success alerts
- publish-failure alerts

For native push, install dependencies after pulling:

```bash
npx expo install expo-notifications expo-constants
```

Then link the app to an EAS project so `projectId` is available.

## Scheduling

Workspace settings control:

- timezone
- minimum spacing
- maximum daily posts
- preferred windows
- blackout windows
- pre-publish alert timing
- no-response policy
- analytics refresh cadence

Approval passes the AI-proposed time through the scheduling engine. Conflicts are moved to the next valid slot.

No-response policies:

- `auto_publish`
- `hold`
- `skip`

## Analytics

Analytics sync runs automatically according to `analytics_refresh_hours` and can also be started manually from the Analytics screen.

Metrics are stored as snapshots in `post_metrics`, preserving historical measurements rather than overwriting previous results.

## Deployment

From the repository root:

```bash
npm ci
npm ci --prefix cloudflare
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
cd ..
npm run deploy:production
```

Production deployment now fails fast unless the app TypeScript check, Worker TypeScript check, and Expo web export all succeed.

The deploy script exports Expo web to `dist/` and deploys the Worker plus static assets.

## Production verification

Verify:

1. `/health` responds successfully.
2. Google sign-in completes.
3. Brand Brain saves and reloads.
4. A source image uploads to R2.
5. AI generation creates a campaign and review posts.
6. Review email opens a valid review link.
7. Approval adds the post to Calendar.
8. A social account can be connected and assigned.
9. Test notification delivers.
10. Publish Now creates a provider post and asynchronous providers reach confirmed `published` status.
11. Analytics sync stores a metric snapshot.
12. A failed provider request produces a readable failure notification.
13. Owner can open More → System Health and readiness is healthy.
14. Owner can open More → Access management.
15. A non-owner account can access only explicitly assigned clients.

## Production operations

Sprint 7 adds owner-only System Health and Access Management workspaces.

The one-minute cron recovers stale publishing, generation, and graphic work and cleans expired authentication/review/media tokens. Operational incidents are persisted in D1.

Only owners have implicit access to all clients. Every non-owner role requires an explicit row in `user_client_access`.

The public `/health` endpoint intentionally returns only minimal dependency state. Detailed diagnostics are authenticated and owner-only.


## Client and Brand Brain production data

BrandSparQ now uses live API data only. Client setup includes:
- client name and timezone
- active/archive lifecycle
- expanded Brand Brain fields
- primary and alternate logos
- approved reference images

The canonical schema is the ordered migration set in `cloudflare/migrations/`; the obsolete standalone `schema.sql` file was removed.

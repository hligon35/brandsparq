# Sprint 6 — Notifications and Analytics

Status: implemented on `main`.

## Notifications

- Unified lifecycle notifications for:
  - content ready for review
  - pre-publish decision
  - publish confirmation
  - terminal publish failure
- Separate delivery receipts for:
  - in-app
  - email
  - Expo push
- Delivery status and provider errors are visible in the Notifications inbox.
- Unread state, mark-read, and mark-all-read are supported.
- Notification preferences now include:
  - review-ready alerts
  - pre-publish alerts
  - publish confirmations
  - publish failures
  - review-link emails
  - email / push / in-app channels
- Secure review-link emails and lifecycle emails use the BrandSparQ navy / blue / cyan / orange identity.
- Dynamic email content is HTML escaped.
- Review-ready alerts are idempotent across generation retries.

## Analytics

- 7 / 30 / 90 day views.
- Client filtering.
- Current aggregate metrics.
- Platform performance.
- Top content ranking.
- Analytics sync health and provider errors.
- Automatic and manual sync history snapshots.
- Daily client/platform analytics rollups.
- Client-access enforcement on analytics refresh.
- Provider collection:
  - Instagram: views, reach, likes, comments, saves, shares
  - Facebook: media views, unique media viewers where available, clicks, reactions, comments, shares
  - X: impressions, likes, replies, reposts
  - TikTok: views, likes, comments, shares
  - LinkedIn organizations: impressions, unique impressions, clicks, likes, comments, shares

## TikTok authorization change

TikTok analytics requires `video.list`. Existing TikTok connections created before Sprint 6 must reconnect once so the new scope can be granted.

Sprint 6 also stores TikTok's final public post ID after provider processing completes so the analytics API can query the published content rather than the temporary publish ID.

## Migration

Apply:

```bash
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
```

Sprint 6 adds:

- `0014_sprint6_notifications_analytics.sql`

## Validation

The repository exposes:

```bash
npm run typecheck
npm --prefix cloudflare run typecheck
```

Run both after pulling `main`, then deploy normally.

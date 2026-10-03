# BrandSparQ implementation status

## Implemented

### Hybrid application
- Expo SDK 57 universal app for iOS, Android, and web.
- Responsive phone, tablet, and desktop layouts.
- BrandSparQ production visual identity and app assets.
- Google OAuth sign-in with server-issued BrandSparQ sessions.

### Brand intelligence and AI
- Per-client Brand Brain.
- Multi-image R2 upload.
- AI campaign planning and structured post generation.
- AI-generated graphics stored in R2.
- Caption rewrite, image editing, and full-post regeneration.
- SparQ Score support.

### Review and calendar
- Review queue.
- Secure review-email tokens.
- Approval into the official marketing calendar.
- Day, week, and month calendar ranges.
- Client and platform filters.
- Conflict-aware scheduling.
- Preferred windows, blackout windows, spacing, and daily limits.

### Campaigns
- Campaign list and progress counts.
- Campaign detail with all generated posts.
- Campaign status, objective, dates, priority, and notes API support.

### Social publishing
- Social connection management.
- Encrypted social tokens.
- Meta Page/Instagram discovery.
- LinkedIn member connections.
- TikTok creator connections.
- X OAuth2/PKCE connections.
- Publishing-account assignment during post review.
- Queue-backed Instagram, Facebook, LinkedIn, TikTok, and X publishing.
- Idempotent attempts, retries, publish receipts, and readable failures.

### Notifications
- Resend email delivery.
- Expo Push Service delivery.
- Native Expo push-token registration.
- In-app notification history.
- Pre-publish alerts.
- Publish success/failure alerts.
- Test notification action.
- Auto-publish / hold / skip no-response policies.

### Analytics
- Analytics overview.
- Manual sync.
- Scheduled background sync.
- Metric snapshot history.
- X and Instagram metric ingestion where provider APIs expose the requested metrics.
- Graceful provider-specific metric gaps.

### Settings
- Workspace timezone.
- Pre-publish timing.
- No-response policy.
- Minimum post spacing.
- Maximum posts per day.
- Preferred and blackout windows.
- Analytics refresh cadence.
- Email, push, in-app, and review-email preferences.

### Production architecture
- One Cloudflare Worker serves Expo web and API.
- D1, R2, two Queues, and cron bindings.
- brandsparq.getsparqd.com production route.
- Production callback URLs for Google and all social providers.
- Dedicated token-encryption secret.
- Production runbook in docs/PRODUCTION.md.

## External configuration still required

These are account-specific values or provider approvals and cannot be safely committed into source control:

- Real D1 database ID in wrangler.toml.
- Cloudflare resources must exist in the target account.
- Worker secrets listed in docs/PRODUCTION.md.
- Google OAuth client credentials.
- Meta app permissions/review as required.
- LinkedIn app/product permissions as required.
- TikTok Content Posting API approval/account eligibility as required.
- X developer app permissions/plan as required.
- EAS project and APNs/FCM credentials for installed-app push notifications.

## Next-phase enhancements

Not required for the current production workflow, but useful later:

- Desktop drag-and-drop calendar interactions.
- Organization-level LinkedIn publishing in addition to member publishing.
- Deeper provider-specific analytics dashboards.
- Team invitations and granular reviewer roles.
- Automatic campaign gap-filling based on historical engagement.

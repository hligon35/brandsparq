# Sprint 4 — Social Publishing Hardening

Status: implemented on `main`.

## Implemented

- Provider acceptance is distinct from confirmed publication.
- Added `provider_processing` post state.
- TikTok direct posts are polled until confirmed or rejected.
- Async provider failures update the post and owner notifications.
- Provider errors are classified as rate limit, authorization, temporary, or permanent.
- Queue retries honor provider retryability and `Retry-After` where available.
- Expired/revoked authorization stops retrying and requires reconnect.
- Social account health, verification time, permission state, expiry, and errors are visible in the UI.
- Manual Verify and Reconnect controls were added.
- Connected accounts receive periodic health checks.
- LinkedIn publishing supports organization URNs when organization accounts are available.
- Optional LinkedIn organization discovery is enabled only when granted organization scopes are configured.
- Meta webhook verification and HMAC signature validation are implemented.
- Verified webhook events are stored for audit/processing.
- Disconnect/reconnect health state is normalized.

## Migration

Apply:

```bash
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
```

Sprint 4 adds:

- `0012_sprint4_social_hardening.sql`

## Production configuration

Add:

```text
META_WEBHOOK_VERIFY_TOKEN
```

Optional, only if the LinkedIn app has been approved for the scopes:

```text
LINKEDIN_ORGANIZATION_SCOPES=w_organization_social r_organization_social
```

# Sprint 7 — Production Hardening and Release Readiness

Status: implemented on `main`.

## Production operations

Sprint 7 adds an owner-only **System Health** workspace with:

- live D1 / R2 / configuration readiness checks
- seven-day publishing and generation job status
- active operational incidents
- failed-post recovery
- manual stuck-work recovery
- incident resolution
- queue recovery history

The public `/health` endpoint exposes only minimal readiness state. Detailed configuration diagnostics are available only to authenticated owners.

## Automatic recovery

The existing one-minute Cloudflare cron now also:

- recovers stale publish jobs after 15 minutes
- recovers stranded publish retries
- recovers stale generation jobs after 30 minutes
- recovers stale graphic jobs
- terminally closes exhausted graphic work through the normal review-finalization path
- removes expired sessions
- removes expired Google and social OAuth states
- removes expired review links
- removes expired signed media/publish tokens
- cleans old rate-limit buckets
- sends messages that exhaust Cloudflare Queue retries to dedicated publish/generation dead-letter queues

Recovery actions and operational incidents are persisted in D1.

Cloudflare Queue consumers now use:

- `brandsparq-publish-dlq`
- `brandsparq-generation-dlq`

These preserve messages that exhaust the configured queue retries instead of allowing them to be discarded.

## Access control

Only the `owner` role has implicit workspace-wide client access.

Non-owner roles require explicit client assignments:

- admin
- reviewer
- publisher
- viewer

Owners can manage roles and client assignments from **More → Access management**.

The system prevents demoting the final workspace owner.

## Security

Sprint 7 adds:

- rate limiting for Google sign-in starts
- rate limiting for secure public review mutations
- request IDs on API responses
- `nosniff`, frame-deny, referrer, and permissions security headers on Worker JSON responses
- minimal public health diagnostics
- generated Wrangler state removed from source control
- `.wrangler` ignored going forward

Review rate limits are keyed by a hash of the review token plus the connecting IP; raw review tokens are not stored in the rate-limit table.

## Reliability and incident visibility

Terminal publishing failures, provider confirmation failures, social account health-check failures, analytics sync failures, stale worker claims, and terminal generation failures are recorded as system events.

The System Health screen lets an owner retry failed posts after the underlying provider/account issue is corrected.

## Deployment safety

`npm run deploy:worker` and `npm run deploy:production` now fail fast through:

1. app TypeScript check
2. Worker TypeScript check
3. Expo web export
4. Worker deployment

GitHub Actions CI performs the same typecheck/build validation for pushes to `main` and pull requests.

The first CI run after adding the workflow failed before a GitHub-hosted runner was assigned; GitHub reported no executed steps or job logs. This indicates a GitHub Actions runner/account-side issue, not a compile result. The workflow remains configured for subsequent runs.

## Native release readiness

`eas.json` now defines:

- development client builds
- internal preview builds
- production builds with automatic build-number/version-code increments

Before the first native production build, initialize/link the Expo EAS project so Expo writes the real project ID used by push notifications:

```bash
npx eas-cli@latest init
```

Then configure Apple/Google signing through EAS and build with:

```bash
npx eas-cli@latest build --platform all --profile production
```

Do not invent or manually copy an EAS project ID from another app.

## Migration

Apply Sprint 7 before deploying:

```bash
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
cd ..
```

New migration:

- `0015_sprint7_production_hardening.sql`

## Recommended production sequence

```bash
git pull origin main
npm ci
npm ci --prefix cloudflare
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
cd ..
npm run deploy:production
```

After deployment, verify:

1. `/health` returns `ok: true`.
2. Owner can open More → System Health.
3. Owner can open More → Access management.
4. Non-owner users only see assigned clients.
5. Google sign-in still succeeds.
6. Create → Review → Calendar → Publish completes.
7. A test notification reaches enabled channels.
8. Analytics sync completes.
9. System Health shows no unresolved production incidents.

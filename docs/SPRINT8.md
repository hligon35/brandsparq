# Sprint 8 — Launch Certification

Status: implementation and local automated validation complete on `main`; final authenticated production acceptance remains required.

Sprint 8 converts BrandSparQ from feature-complete to release-verifiable.

## Launch blockers fixed

- Native release builds no longer fall back to localhost. Development uses `http://localhost:8787`; production defaults to `https://brandsparq.getsparqd.com`.
- Web bearer persistence is session-scoped instead of long-lived local storage.
- Any authenticated API `401` clears the stale local session consistently.
- Owner operations screens are explicitly registered in root navigation.
- Expo configuration was normalized.
- Shared buttons/status badges have stronger accessibility semantics.

## Automated launch audit

Run:

```bash
npm run audit:launch
```

It verifies:

- required release files/assets
- production Worker domain and redirect settings
- real D1 binding
- R2 and Queue configuration
- dead-letter queues
- migration sequence integrity
- production native API fallback
- placeholder/TODO leakage in release source
- Expo icon/favicon configuration
- EAS project linkage warning

The audit is part of `npm run validate`, so production deployment fails before Wrangler deploy if a launch blocker is detected.

## Owner Launch Certification

Open:

**More → System Health → Run launch check**

The server-side certification checks:

- D1 and R2 readiness
- required production secrets
- production base URL
- Google OAuth callback
- required database schema
- at least one workspace owner
- client-access referential integrity
- unresolved error/critical incidents
- failed posts
- connected social providers and required credentials

Results are persisted in `launch_certification_runs`.

Statuses:

- `ready` — no automated blockers or warnings
- `ready_with_warnings` — deployable, but operational items need review
- `blocked` — do not launch until blockers are resolved

## Push delivery certification

Sprint 8 now checks Expo push receipts after ticket delivery.

- final receipt failures update notification delivery status
- parent notification becomes `partial` or `failed`
- `DeviceNotRegistered` tokens are automatically disabled
- receipt-check failures become System Health incidents

This closes the gap between “Expo accepted the push request” and “Expo confirmed delivery processing.”

## Production smoke test

After deployment:

```bash
npm run smoke:production
```

This non-destructively verifies:

1. `/health` returns healthy without leaking detailed secret/configuration diagnostics
2. `/login` serves the Expo web application
3. Google OAuth start returns a Google redirect instead of 5xx
4. protected API endpoints reject unauthenticated requests

Override the target only when intentionally testing another deployment:

```bash
BRANDSPARQ_BASE_URL=https://example-preview.example npm run smoke:production
```

## Migration

Sprint 8 adds:

- `0016_sprint8_launch_certification.sql`

Apply:

```bash
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
cd ..
```

## Release sequence

```bash
git pull origin main
npm ci
npm ci --prefix cloudflare
npx playwright install --with-deps chromium webkit
npm run audit:launch

cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
cd ..

npm run deploy:production
npm run smoke:production
```

Then sign in as an owner and run **System Health → Run launch check**.

## Native release

Native release still intentionally requires the real Expo/EAS project to be linked:

```bash
npx eas-cli@latest init
```

That command supplies the real EAS project ID required by Expo push notifications and production builds. Do not copy a project ID from another application.

After EAS is linked and native credentials are configured:

```bash
npx eas-cli@latest build --platform all --profile production
```

## Manual final acceptance

Automated checks cannot certify third-party account approval or content quality. Before public launch, manually verify one complete production path:

Google sign-in → select/create client → Brand Brain → upload images → AI generation → review email → secure review/edit/regenerate/approve → calendar → pre-publish decision → real social publish → success notification → analytics sync.

Also verify each social provider you intend to support has production app approval and the exact redirect/webhook URLs configured in that provider dashboard.

## Known external CI issue

The BrandSparQ CI workflow is configured to run the launch audit, app TypeScript check, Worker TypeScript check, and Expo web export. Recent GitHub Actions runs have failed before a runner was assigned and contain no executed steps/logs. That remains a GitHub Actions account/repository runner issue rather than a code validation result.

Do not treat CI as passing until GitHub actually assigns a runner and all validation steps complete successfully.

## Continuation: behavioral regression gate

`npm test` now executes 16 behavioral tests against the actual Worker modules and a fresh in-memory SQLite database with all 16 production migrations applied. It requires Node 22.15 or newer. D1 statements and transactional batches execute real SQL; R2, queues and external notification receipts use isolated test doubles. No production accounts, AI calls, emails or social posts are used by this suite.

Coverage includes public health redaction, production CORS, expired/revoked sessions and logout, concurrent single-use OAuth handoffs, client isolation, source/derivative/generated media permissions, Brand Brain saves, generation asset ownership and queue submission, public review transitions and replay rejection, schedule versioning, duplicate publish claims/retries, Indianapolis daylight saving and calendar constraints, Expo receipt failures, launch certification persistence, incident deduplication, analytics history/access, publish-now queue submission and malformed bulk actions.

The regression suite now runs in GitHub CI and in `npm run validate`, including the pre-deployment gate.

Additional fixes:

- Synchronized the image-manipulator lockfile so clean `npm ci` installations succeed.
- Fixed the Brand Brain INSERT placeholder mismatch that prevented profile saves.
- Added the missing social account verification import and corrected API/bulk-action types that failed TypeScript validation.
- Claimed OAuth handoffs atomically before creating a session, preventing concurrent replay.
- Enforced client permissions on raw R2 media requests; untracked keys are unavailable through this route.
- Removed implicit localhost CORS access in production. Explicit `ALLOWED_ORIGINS` entries remain supported for intentional development against a production API.
- Validated bulk post ID collections before database binding.
- Added heading accessibility semantics and increased small-button minimum height to 44.
- Limited each production smoke request to 15 seconds.

Validation on October 4, 2026: all 16 regression tests, launch audit, both TypeScript checks and Expo web export passed locally. The existing deployed production site passed the four public smoke checks (health, login SPA, Google OAuth redirect and API authentication guard). This smoke result does not certify deployment of these new changes.

Still required: link the real EAS project for native releases/push, deploy this commit, confirm GitHub CI executes successfully, and complete the authenticated production journey described above with real provider approvals. Browser layout inspection and real AI generation/social delivery are outside the headless regression coverage.

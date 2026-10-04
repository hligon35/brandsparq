# Sprint 8 — Launch Certification

Status: implemented on `main`.

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

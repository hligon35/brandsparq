# Sprint 9 — Quality Gate (final sprint)

Status: implementation complete; local web quality gate verified. Native-device execution, deployed staging smoke and GitHub runner execution remain external acceptance requirements.

## Automated coverage

- 28 unit/integration tests execute the actual Worker modules and all 16 migrations against isolated SQLite. They cover permissions, encryption, sessions, uploads, generation, review, scheduling, publishing, notifications, analytics and launch certification.
- OpenAI Responses/image edits, Meta publishing/analytics, Resend and Expo delivery use deterministic mocks, including rate limits, malformed responses, retries and duplicate queue delivery. No live provider credentials are needed.
- 15 Playwright acceptance checks run on desktop Chromium, Pixel-sized Chromium and iPhone-sized WebKit. They exercise login/session restoration, Brand Brain persistence, public review edits/approval, calendar placement, publish-now queue delivery, notifications, analytics, expired sessions and invalid review links against the actual Worker API.
- Biome enforces consistent formatting and error-level correctness rules across app, Worker, scripts and tests. TypeScript checks both projects.
- The browser fixture server is loopback-only, uses isolated test data and is never included in the deployed Worker or Expo export. Its fixture handoff is unavailable in production.

## Local quality gate

Use Node 22.15 or newer:

```bash
npm ci
npm ci --prefix cloudflare
npx playwright install --with-deps chromium webkit
npm run validate
```

`validate` runs launch audit, lint, formatting, unit/integration tests, both TypeScript checks, Expo web export and all browser projects. Deployment scripts run this gate first. Browser binaries must be installed on deployment machines.

Individual commands: `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm run lint`, `npm run format:check`. Use `npm run format` before committing source changes. Failed browser runs retain traces/screenshots in `test-results/` and an HTML report in `playwright-report/`.

The main GitHub Actions workflow installs both projects and browser/system dependencies, runs the complete gate on pushes and pull requests, and uploads browser artifacts even after failure. Native and staging workflows are manual because they require a prepared device and deployed staging origin.

## Native acceptance

The Maestro flow in `.maestro/workspace.yaml` verifies fresh launch, a test OAuth handoff, review navigation, multiple clients and logout. Run it on a dedicated emulator/simulator with a freshly installed test build. iOS SecureStore can survive an uninstall; use a fresh simulator/keychain rather than a device containing personal credentials.

First link this repository to its real EAS project (see Sprint 8), then build/install the isolated binary:

```bash
npx eas-cli@latest build --profile e2e --platform android
# Or on a macOS host with an iOS simulator:
npx eas-cli@latest build --profile e2e --platform ios
```

The `e2e` profile supplies `EXPO_PUBLIC_API_URL=http://127.0.0.1:8788` and `BRANDSPARQ_E2E_BUILD=1`. The dynamic Expo configuration permits local HTTP only for that profile; production configuration retains its existing transport policy. Never distribute this build as a production release.

Install Maestro and the selected binary, boot one dedicated device, then:

```bash
npm run build:web
npm run test:mobile
# For iOS:
BRANDSPARQ_MOBILE_PLATFORM=ios npm run test:mobile
```

The launcher creates an isolated fixture server, sets Android `adb reverse` for port 8788, executes Maestro and closes the server. The iOS simulator reaches host loopback directly. The JUnit result is written to `test-results/native.xml`. Leave port 8788 free. On Windows PowerShell, set environment values with `$env:BRANDSPARQ_MOBILE_PLATFORM = 'android'`.

The `BrandSparQ native E2E` workflow requires a trusted dedicated self-hosted runner labeled `brandsparq-mobile`, Maestro, a booted device and the installed EAS e2e binary. It is intentionally manual and does not run untrusted pull requests on that runner.

## Staging smoke

Deploy a separately configured staging environment with its own resources, secrets and OAuth redirects. This sprint does not create or deploy one. Then run:

```bash
BRANDSPARQ_BASE_URL=https://your-staging-origin.example npm run smoke:staging
```

Or dispatch `BrandSparQ staging smoke` with the HTTPS staging origin. Missing, malformed and known production targets are rejected before any request. The read-only smoke checks health redaction, the login SPA, Google OAuth redirect and unauthenticated API guards, with a 15-second timeout per request.

## Fixes found by the quality gate

- Session restoration now finishes before protected screens mount. A fresh authenticated deep link previously raced its first API request against token restoration, received a 401 and cleared a valid session.
- Root navigation guards private routes consistently and removes the login route after sign-in.
- Brand Brain and public review fields, plus the Google sign-in button, expose accessible labels for screen readers and UI automation.
- Existing source formatting was normalized to establish a passing formatter baseline; the publish screen's unused import was removed.

## Acceptance evidence and limits

On October 4, 2026, 28 unit/integration tests and 15 browser checks passed locally, along with launch audit, lint/format, both TypeScript checks and web export. WebKit required dependencies extracted into the local browser cache and a local host-validator bypass because this managed environment cannot install system packages; browser execution itself passed. CI installs those dependencies normally and does not bypass validation.

Native transport configuration was inspected for both release and test profiles. No emulator, Maestro installation, linked EAS project or deployed staging origin is available in this workspace, so native execution and staging smoke are not certified. GitHub CI must actually assign a runner and finish before it can be called green. Real AI output, Google account login, social provider approval and live delivery still require the authenticated production acceptance in Sprint 8.

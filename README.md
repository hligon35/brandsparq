# BrandSparQ

Mobile-first Expo web/mobile app for turning raw brand images into strategic social content, routing it through review and approval, placing approved posts on a multi-client marketing calendar, and publishing through connected social platforms.

## Core flow
Images → AI analysis → graphics/captions → strategic slot suggestion → review/edit/approve → calendar → pre-publish alert → keep / reschedule / publish now → publish → analytics.

## Stack
Expo + React Native + Expo Router + TypeScript; Cloudflare Workers, D1, R2 and Queues.

The web client and iOS/Android apps share the Expo Router application and React Native screens, with platform-native navigation and capabilities. Native build profiles and device acceptance steps are in [Sprint 9](docs/SPRINT9.md).

## Current production capabilities
- Google OAuth and RBAC
- Multi-client Brand Brain
- Client onboarding and archive lifecycle
- Brand asset uploads
- AI campaign generation and review
- Real dashboard metrics
- Scheduling and calendar controls
- Durable queue-based publishing
- Social account connections and publishing adapters
- Notifications and analytics foundations

## Local start
1. `npm ci`
2. Copy `.env.example` to `.env`
3. `npm ci --prefix cloudflare`
4. Configure `cloudflare/.dev.vars`
5. `npm start` or `npm run web`
6. In another terminal: `npm --prefix cloudflare run dev`

For native testing on a physical phone, the app uses the hosted HTTPS API by default. A phone's `localhost` points to the phone, not your development computer. To use a local Worker from a phone, set `EXPO_PUBLIC_API_URL` to the computer's LAN IP and configure the Worker and Google OAuth callback for that reachable URL. Restart Expo with `npx expo start --clear` after changing the variable.

Production data comes from the Cloudflare API; demo fallbacks are not used.

## Quality gate

With Node 22.15+, install root and Worker dependencies, then run `npx playwright install --with-deps chromium webkit` and `npm run validate`. The gate includes lint/format, unit/integration tests, both TypeScript checks, web export and browser acceptance tests.

See [Sprint 9](docs/SPRINT9.md) for native Maestro setup, staging smoke, CI and remaining release acceptance.

The [Phase 1 workflow safety update](docs/WORKFLOW_SAFETY.md) documents correctness/privacy fixes and migration 0017.

The [Phase 2 workspace experience update](docs/WORKSPACE_EXPERIENCE.md) documents generation recovery, team/client roles, review delivery and migration 0018.

## Windows formatting recovery

Git and editor settings enforce LF source line endings across platforms. If an existing Windows checkout reports formatting errors across most or all files after pulling, normalize it once:

```powershell
git pull origin main
npm run format
npm run format:check
```

This preserves the formatting gate; increasing `--max-diagnostics` only displays more errors. Avoid committing unrelated edits during recovery.

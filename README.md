# BrandSparQ

Mobile-first Expo web/mobile app for turning raw brand images into strategic social content, routing it through review and approval, placing approved posts on a multi-client marketing calendar, and publishing through connected social platforms.

## Core flow
Images → AI analysis → graphics/captions → strategic slot suggestion → review/edit/approve → calendar → pre-publish alert → keep / reschedule / publish now → publish → analytics.

## Stack
Expo + React Native + Expo Router + TypeScript; Cloudflare Workers, D1, R2 and Queues.

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
1. `npm install`
2. Copy `.env.example` to `.env`
3. `npm start`
4. `npm run web`

Production data comes from the Cloudflare API; demo fallbacks are not used.

## Quality gate

With Node 22.15+, install root and Worker dependencies, then run `npx playwright install --with-deps chromium webkit` and `npm run validate`. The gate includes lint/format, unit/integration tests, both TypeScript checks, web export and browser acceptance tests.

See [Sprint 9](docs/SPRINT9.md) for native Maestro setup, staging smoke, CI and remaining release acceptance.

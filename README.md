# BrandSparQ

BrandSparQ is an Expo / React Native / web marketing workspace that turns brand assets into AI-assisted social campaigns, routes content through review, schedules approved posts, publishes through connected social providers, and records analytics.

## Core flow

Images → AI analysis → campaign plan → generated creative/captions → review/edit/approve → scheduler → pre-publish decision → social publish → provider/analytics tracking.

## Stack

- Expo + React Native + Expo Router + TypeScript
- Cloudflare Workers, D1, R2, Queues and Cron
- Google OAuth
- OpenAI text/image generation
- Meta, LinkedIn, TikTok and X adapters
- Resend + Expo notifications

## Local development

1. `npm ci`
2. Copy `.env.example` to `.env`
3. `npm ci --prefix cloudflare`
4. Configure `cloudflare/.dev.vars`
5. `npm start` or `npm run web`
6. In another terminal: `npm --prefix cloudflare run dev`

Demo fixtures are development-only. Production UI must show real loading, empty, authentication, and failure states rather than falling back to sample customer data.

## Production safety

Apply D1 migrations before deploying Worker code that depends on them. The production-readiness work introduces durable publish jobs, generation retry slots, client lifecycle fields, expanded Brand Brain fields, upload hashes and social account uniqueness.

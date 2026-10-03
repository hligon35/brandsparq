# BrandSparQ Cloudflare backend

The Expo app is the control surface; scheduling, generation, publishing, auth, notifications, and analytics are server-side.

Implemented:
- Worker API
- D1 migrations
- R2 media storage
- publish and generation Queues
- cron dispatcher
- Google OAuth and RBAC
- AI generation jobs
- signed media delivery
- Resend / Expo notification plumbing
- Meta, LinkedIn, TikTok and X adapters
- client and Brand Brain management

Migrations in `cloudflare/migrations/` are the canonical database schema.

Never place social-provider secrets in `EXPO_PUBLIC_*` variables.

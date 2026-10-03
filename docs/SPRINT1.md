# Sprint 1 — Reliability and Safety

Status: implemented on `main`.

## Reliability invariants

### Scheduling
- Empty blackout windows mean no blackout.
- Preferred windows, blackout windows, weekdays, daily limits, minimum spacing, and client timezones use one scheduling service.
- Approval and manual rescheduling both use the same scheduler.
- A post being rescheduled is excluded from its own collision check.

### Publishing
- One durable `publish_jobs` record represents one logical publish execution.
- Queue delivery attempts are stored separately in `publish_attempts`.
- Retries no longer self-cancel because a previous failed attempt exists.
- Cron and Publish Now converge on the same publish job.
- `publish_version` invalidates stale queued work after a reschedule.
- Repeated cron runs cannot create a new logical publish execution for the same post version.
- Explicit state-transition guards prevent stale requests from re-approving or re-publishing terminal posts.

### Generation
- Generation jobs persist their campaign plan, campaign ID, post IDs, current stage, and review-email state.
- Queue retries resume existing work rather than recreating campaigns and posts.
- Existing graphics are not regenerated during replay unless missing.
- Exhausted generation queue deliveries are marked `failed` rather than remaining indefinitely in `retrying`.

### Media
- Authenticated post APIs issue short-lived media URLs.
- Generated R2 objects remain private.
- Web and native image components no longer depend on attaching an API bearer token to image requests.

### Authentication and authorization
- Production Google onboarding fails closed for unknown users.
- Existing provisioned users can continue to sign in.
- The first explicitly authorized account can bootstrap as owner; subsequent new accounts default to viewer.
- RBAC is enforced server-side.
- Non-owner/admin users require explicit client access through `user_client_access`.

Roles:
- owner — all workspace permissions
- admin — operational administration except owner-only workspace settings
- reviewer — read, review, and AI-edit
- publisher — read, calendar, and publish
- viewer — read-only

### Publishing destinations
- The first connected account for a client/platform becomes its default if none exists.
- Generation preassigns the clear default publishing account.
- Approval verifies that the destination is still connected.
- Email and in-app approval stop with a clear conflict if no valid destination exists.

## New migrations

Apply:

```bash
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
```

This applies:

- `0008_sprint1_reliability.sql`
- `0009_publish_versioning.sql`

## Required production configuration

Google OAuth must authorize exactly:

```text
https://brandsparq.getsparqd.com/v1/auth/google/callback
```

Production should define:

```text
AUTH_PEPPER
AUTH_ALLOWED_EMAILS
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

An empty `AUTH_ALLOWED_EMAILS` no longer bootstraps arbitrary new users in production.

## Verification limitation

The ChatGPT execution environment used for this implementation could not resolve `github.com` from its local container, so a fresh local npm install/typecheck could not be run there. The implementation was verified structurally against the current GitHub `main` branch through the GitHub connector.

The repository's later Quality Gate sprint should add automated Worker, migration, queue, and end-to-end tests so these invariants are continuously verified.

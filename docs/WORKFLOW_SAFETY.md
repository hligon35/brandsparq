# Phase 1 — Workflow correctness and privacy

This phase addresses the nine high-priority defects from the October 15 review. Product-management UI and external release certification remain separate work.

## Behavior changes

- Social OAuth starts with an authenticated `POST /v1/social/connect` and returns an `authorizationUrl`; the web/native app opens only that URL. The obsolete GET start route is removed. Invalid return destinations return a readable 400, production disallows arbitrary localhost returns, and OAuth state consumption is atomic.
- Publishing and receipt polling refresh the social account's credentials, not a post or receipt ID.
- Notification network failures become delivery failures. Failed transports have independent, claimed cron retries (three total attempts, within one day). Email retries reuse a stable idempotency key; push delivery can still be duplicated if the push provider accepts a request but its response is lost. Successful channels are not resent.
- Owners receive workspace notices; admins receive post notices only for assigned clients. Historical notification reads/read-all actions and delivery retries recheck current client access.
- A durably published post is never reverted to the publish retry path when follow-up work fails. Stale publish recovery completes jobs whose post is already published or processing at the provider.
- A lost/invalid final provider response, provider server error, missing publication ID or failed receipt persistence creates `PUBLISH_OUTCOME_UNKNOWN`. The job stops, System Health records the incident, and automatic/owner retry is blocked. Check the provider before preparing replacement content. The subsequent [Phase 1 workflow implementation](PHASE_ONE_WORKFLOW_CORRECTNESS.md) adds owner reconciliation with mandatory provider evidence and a separate explicit retry.
- Generation jobs use an atomic claim so simultaneous queue deliveries cannot create duplicate campaigns. Existing plan/post records are retained for retries. OpenAI calls have a three-minute deadline.
- AI mutations acquire the review post before any provider call. Scheduled, paused, published, publishing, canceled and provider-processing posts cannot be rewritten/regenerated. Concurrent review edits cannot start another AI operation or approve during the claim. Failures return to `edit_requested`.
- Archiving waits until active generation/publishing/AI edits finish. Once archived, pending publish/generation/graphic jobs are canceled, nonterminal posts are paused, publish versions change and review links expire. New mutation/queue claims require an active client. Historical published content is retained. Archived browsing/restoration is a later UI task.
- A shared accessible web dialog replaces React Native Web's empty Alert implementation; native alerts remain native. Social callback failures are displayed after returning from the provider.
- Worker JSON responses explicitly use `Cache-Control: no-store`, including auth errors and handoffs.

## Deployment

Apply the additive migration before deploying the updated Worker/app together:

```bash
npm ci
npm ci --prefix cloudflare
npx playwright install --with-deps chromium webkit
npm run validate
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
cd ..
npm run deploy:production
```

Migration `0017_workflow_safety.sql` adds notification retry/claim columns, their index and the generation claim token. It does not remove production records. Migration application and production publication were not performed from this workspace.

## Validation

The test suite now contains 42 unit/integration tests. Fourteen new cases cover authorized social starts, no-store responses, notification-only retry/concurrency, unknown submission outcomes, client isolation/revocation, refresh-token rotation, generation replay, AI state/concurrency guards, archive cancellation, receipt-persistence failure and approval/revision races.

The browser suite contains eight workflows in each of desktop Chromium, mobile Chromium and mobile WebKit (24 checks). Added workflows verify visible browser errors, authenticated social-start requests and provider callback error messages. All external provider calls in acceptance tests are fixtures.

Native-device testing, working GitHub CI, deployed staging, Cloudflare Access policy, live provider approvals and the authenticated production journey remain external acceptance requirements. These tests do not certify those environments.

# Phase 2: workspace experience

Phase 2 extends the Phase 1 workflow safety controls with usable recovery, access and review workflows.

## Delivered

- **Generation:** current stage, graphics counts and failure details, with five-second polling while the screen is focused. Failed/canceled work can be retried without recreating its campaign; queued/rendering work can be canceled when no graphic is processing. Active planning/graphics must finish before cancellation. Queue delivery errors remain retryable.
- **Campaigns:** editable name, objective, notes, dates, priority and lifecycle status, with validation and readable loading/save errors. Campaign status is metadata; pausing posts uses Calendar controls.
- **Client recovery:** archived-client browsing and explicit restoration. Restoring a client never resumes publishing automatically. Paused approved posts can receive a new valid calendar slot; unfinished graphics return to review; paused posts can be canceled.
- **Brand Brain:** detach uploaded assets while retaining historical originals, choose a primary/alternate logo, and supply approved reference images to campaign planning and graphic generation.
- **Review delivery:** per-client reviewer recipients, enable/disable controls, per-recipient link replacement, explicit link revocation and delivery history. With no configured reviewers the workspace recipient is used. A configured list with all reviewers disabled sends no fallback email.
- **Team access:** owner-managed Google invitations, pending/expired/accepted/revoked states, resend with token rotation, suspension/removal/reactivation and session revocation. Verified Google email must match an unexpired pending invitation. Invitations do not bypass Google identity verification. Invite email delivery errors remain visible.
- **Client roles:** effective per-client admin/reviewer/publisher/viewer permissions, shared with the UI. Existing assignments retain their workspace-role behavior until explicitly changed. Only owners have implicit client access. Controls are hidden or disabled when the current user lacks permission.
- **Native notifications:** user-bound post deep links, initial/background response routing, device unregistration on sign-out and duplicate Google handoff protection. Review and publishing notices follow the effective client role.

## Migration and release order

Apply all pending migrations, including `0018_workspace_experience.sql`, before deploying this Worker and app together. The production-readiness and workflow-safety migrations both use the 0017 prefix; retain and apply both files before 0018. Migration 0018 adds user status, explicit client role overrides, logo preference, paused-post origin, invitations, client reviewers and delivery/revocation records. Existing users default to active and client overrides default to null.

```bash
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
```

Migration/deployment is an operational release step; local tests do not apply remote migrations. Retain the existing database backup and rollback process. No production migration, provider publication or live invitation email was performed during implementation.

## Verification

`npm run validate` covers migration replay, backend integration tests, app/Worker type checks, lint/format, Expo web export and browser acceptance on desktop Chromium, mobile Chromium and mobile WebKit. The isolated browser server blocks unmocked external network calls. Tests exercise generation recovery, campaign editing, archive restoration, paused content, invitations, reviewer links and read-only roles in addition to the existing publishing workflow.

Physical iOS/Android push delivery, account switching with real devices, native Google callbacks, real Resend delivery, provider permissions and production OAuth remain release acceptance items. Link an EAS project, configure credentials and run the native Maestro/release checklist in [Sprint 9](SPRINT9.md). Run the authenticated production smoke and provider acceptance checks after deployment. A local green gate does not certify those external systems.

## Concurrent main reconciliation

This change also resolves conflict markers committed in main's production-readiness merge. It preserves byte-inspected/deduplicated uploads, cross-midnight scheduling with edited-post exclusion, deterministic generation slots, additional Brand Brain fields, throttled session activity writes, request timeouts and Cloudflare build configuration. Duplicate dashboard/client/OAuth handlers were reconciled into the existing client-scoped implementations. The quality gate retains browser tests and checks the combined source.

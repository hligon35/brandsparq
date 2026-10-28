# Gap closure — Phase 1: saved data and approval integrity

## Implemented scope

This closes audit findings G01–G05 and G09 in the Phase 1 implementation plan. It does not close the publishing, upload recovery, analytics, dependency and physical acceptance work scheduled for later phases.

- Brand Brain preserves omitted primary/alternate logo selections; null explicitly removes one. Saving client name/timezone and brand fields now uses one D1 transaction with a captured revision and a unique transaction stamp. It returns canonical state. Failure rolls back both records.
- Attaching a first logo creates a missing brand-profile row. Attach/remove operations are transactional and revision-checked. Their returned revision belongs to that exact mutation; it is not taken from a later unrelated read. Existing source files are retained on removal.
- Campaign, Brand Brain and post-copy editors send the revision originally loaded. Stale writes return 409; missing editor revisions fail closed with 428. Client identity changes through the separate client endpoint also require a revision.
- Conflict UI retains local edits and provides Reload latest, with a confirmation before replacing them. Late entity-load responses are fenced against route changes and newer loads.
- Destination assignment is conditional on the post still being unapproved and in review at the expected content revision, with a healthy, unexpired, credential-bearing destination for the correct client/platform.
- Single, public-link, bulk and campaign approval carry the reviewed content revision. The scheduling transaction compares content revision and chosen destination and rechecks destination readiness. A destination/copy change during scheduling makes approval fail. A late destination write after approval also fails.
- Copy-edit comments are gated by a unique successful-edit stamp, so a failed stale save cannot append its comment through another editor's revision.
- Disconnect advances the connection revision and clears any refresh lease and both credentials. Pending verification/refresh successes and failures cannot alter the newer state.
- Token refresh uses a D1 claim shared across workers, a bounded request and a lease/token/revision fence. Only one refresh may use the rotating credential at once. An older response cannot overwrite a newer refresh winner or reconnect. Temporary refresh failures retain authorization rather than unconditionally demanding reconnect.
- OAuth snapshots the connection revisions when authorization starts, checks them during the final upsert and rechecks actor/client authority at persistence. OAuth started before a disconnect cannot restore it. A fresh explicit authorization can reconnect it.
- Schema certification checks required revision triggers as well as tables/columns/indexes. Removing a required trigger blocks certification.

## Migration and client compatibility

New migration: `cloudflare/migrations/0027_gap_closure_integrity.sql`.

It adds revision/stamp/refresh-lease fields and revision triggers. It does not delete user data. The migrated fixture applies every existing migration plus 0027. The schema manifest was regenerated.

Apply and verify the migration on isolated staging before deploying this Worker and its updated client there. Production must use the existing guarded release process after later-phase acceptance; this implementation did not execute remote migrations or deploy.

Older editor clients that omit revisions receive 428 rather than being allowed to overwrite newer work. Publish the updated web/installed-app JavaScript as part of the coordinated release. This phase adds no native dependency or ABI change; app/runtime version remains 0.1.1. That does not eliminate earlier rebuild requirements for an older binary/runtime.

Example from the repository root, after staging configuration/resources are provisioned:

```sh
npm run schema:check
npm run migrate:staging
```

No production rollout or bypass of evidence/dependency gates is implied by these commands.

## Verification

- 234 Node backend/unit/regression tests passed: all 217 previous tests and 17 new Phase 1 tests.
- The new cases cover retained/removed logos, missing-profile attachment, atomic rollback, stale brand/campaign/post editors, comments on rejected writes, both destination/approval orderings, final destination readiness, public/bulk snapshot approval, late verification/refresh, reconnect, concurrent refresh, an expired lease, OAuth authority revocation and required revision-trigger certification.
- Existing workflow fixtures now explicitly model an editor's loaded revision. Concurrency tests supply the old snapshot deliberately; missing-revision tests use ordinary requests without one. The production test server does not inject revision fields.
- Added two browser regressions for keeping local edits on conflict and preventing stale approval; strengthened logo/color browser coverage to assert the actual selected logo after saving. Updated direct browser fixture approval setup to send its loaded revision.
- Root/Worker TypeScript, lint, formatting, schema and launch checks passed. The launch audit sees 28 migration files.
- Web and Android/iOS JavaScript exports passed. Worker packaging dry run passed.
- Browser execution remains blocked in this environment: the Chromium executable is absent and download retries (including the headless-shell-only package) fail on invalid/truncated archives. No browser pass is claimed for this phase. Run the browser cases in a provisioned runner before release.

These tests use isolated SQLite/R2/queue/provider fixtures. They do not prove physical-device, real provider, staging configuration or production acceptance.

## Remaining gates

The fresh dependency audit still blocks on the newly unreviewed deepmerge advisory, alongside the tracked Zod issue. No dependency exception, incompatible override or release evidence was fabricated. Those findings remain in Phase 3's dependency work and Phase 4's release verification.

The remaining audited feature gaps (hashtags/final copy, truncation, alert selection, media validation/repair, legacy generation, paused pagination, native API resolution and the other source-level findings) remain scheduled for Phases 2–3. Green hosted CI and complete browser/device/provider/restore acceptance remain Phase 4 work.

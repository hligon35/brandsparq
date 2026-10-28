# BrandSparQ functionality and gap closure audit

Date: October 27, 2026. Scope: intended BrandSparQ workflow—client setup, Brand Brain and media, AI creation/revision, review, scheduling, social publishing, notifications, analytics, profile/access, recovery and release safeguards.

> Historical baseline: Phase 1 implementation now addresses G01–G05 and G09. See [GAP_CLOSURE_PHASE_ONE.md](GAP_CLOSURE_PHASE_ONE.md) for implementation and verification status. The reproduction probes below deliberately describe the original audited commit.

## Conclusion

**There are remaining coding gaps.** The previous phases improved the application but did not establish complete feature correctness. This pass reproduced 14 adverse scenarios and identified further source-level reliability gaps. The existing 217 tests all pass despite those defects. Do not treat their count, a merged PR or a successful compile as complete acceptance.

Audited source: `924ab3b7d098f5ffb76d82bf0e15640caa7fffdc`. PR #23 is merged as `52a3ef55da4b7ec842f18c0d4dc8b942d8ead099`; the fetched main tree is identical to the audited tree. No application fixes, deployment, migration, OTA or pilot activation were performed in this analysis.

### Evidence and limits

| Check | Result |
| --- | --- |
| Existing backend/unit/regression suite | 217 passed, 0 failed in this audit. |
| New isolated audit probes | All 14 adverse scenarios reproduced against current source. These probes deliberately assert the bad behavior; their passing is evidence of defects. |
| TypeScript | Root and Worker passed. |
| Schema / lint / formatting / launch audit | Passed before adding these audit artifacts. Launch audit found 27 migration files. |
| Dependency gate | Failed on newly unreviewed `deepmerge` advisory GHSA-gcqx-w48m-w2h4. |
| Fresh root npm audit | 8 affected package entries: 3 high, 5 low; two leaf advisories, Zod and deepmerge. Counts include transitive parents, not eight distinct vulnerabilities. |
| Fresh Worker npm audit | 0 vulnerabilities reported. |
| Full browser suite | Attempted 165 cases; browser launch blocked because executables are absent. Browser installation failed on a truncated/non-ZIP download. No fresh browser application pass is claimed. Earlier 12 targeted cases remain historical evidence. |
| Hosted CI | PR-source run 40585103788 concluded failure; validate job 122474340347 exposes no steps/log URL and its fetched log is unavailable. The prior billing explanation was not independently reconfirmed for this run. The connector's commit-run lookup only returns PR-triggered runs, so an empty merge-commit lookup does not prove no main-branch run exists. |
| Physical and live acceptance | Not performed. |

Reproduce locally from the repository root:

```sh
node --import ./tests/register.mjs --test docs/evidence/2026-10-27-gap-reproductions.mjs
```

These use migrated in-memory SQLite, fake R2/queues and mocked provider requests. They do not contact production. The native URL probe evaluates the actual source expression using an SDK-shaped constants object; it is not a physical-device test. The destination race injects another writer's approved state immediately before the final destination write.

## A. Reproduced code defects

P1 means fix before real publishing/pilot. P2 means functional/recovery completeness work required before claiming closure. IDs below map to explicit audit probe titles.

### G01 — Saving Brand Brain clears both selected logo pointers — P1

**Source:** `app/clients/[clientId]/brand.tsx` load/save; `cloudflare/src/index.ts` POST brand, approximately lines 878–1009.

The screen builds its form without `logoAssetId` and `alternateLogoAssetId`. Saving that form sends no pointers, but the upsert turns omitted values into null and overwrites both existing selections. The asset list can still show the logos, masking that generation no longer has a selected logo. This also affects the normal upload → extract colors → Save Brand Brain sequence.

**Close:** preserve omitted pointers; distinguish explicit removal from omission; return canonical saved state; test that voice/color edits and the upload/color/save/reload cycle retain both pointers and that generation receives the selected logo. The current browser logo test checks colors after saving, but does not check logo selection or the generation input.

### G02 — Logo attachment falsely succeeds when a profile row is missing — P2, conditional recovery path

**Source:** `cloudflare/src/index.ts`, POST brand-assets, approximately lines 842–874.

Attachment inserts an asset association and then only UPDATEs the profile. If the profile row is missing, it returns success without selecting the logo. This was reproduced with a client missing its profile. Normal client creation does create a profile in the same transaction; this is a legacy/import/recovery edge case, not every new-client upload.

**Close:** atomically create/upsert the profile and selection with the attachment, or return a clear repairable conflict. Test a deliberately missing profile and concurrent first attachments.

### G03 — A late verification can undo Disconnect — P1

**Source:** `cloudflare/src/social.ts`, `verifySocialAccount`; `cloudflare/src/management.ts`, disconnect route.

Start Verify, disconnect while the provider response is pending, then release verification. The verifier's unconditional UPDATE restores connected/healthy status even though Disconnect removed the credentials. The UI can show a false healthy connection.

**Close:** use a connection revision or equivalent compare-and-set fence, and reject writes from the earlier connection epoch. A stale failure must also not degrade a newly reconnected account.

### G04 — A late refresh restores credentials after Disconnect — P1

**Source:** `cloudflare/src/social.ts`, `accountToken`, approximately lines 729–847.

The stronger variant was reproduced with a token refresh: Disconnect clears access and refresh tokens, but a pending successful refresh writes both credentials back and marks the account connected. The user's revocation loses.

**Close:** fence refresh success and failure by connection revision and original token identity; serialize/coalesce rotating refreshes across workers; never allow stale refresh to overwrite a newer reconnect. Test disconnect, reconnect, concurrent refresh and authorization failure interleavings separately.

### G05 — Destination assignment can change after approval — P1

**Source:** `cloudflare/src/management.ts`, social-account route, approximately lines 367–399.

The route checks review status, performs other awaits, then updates by post ID alone. Another writer can approve the post before that final UPDATE. The approved/scheduled post's destination still changes. This was reproduced by placing the concurrent approved state immediately before the UPDATE.

**Close:** perform a conditional final write using review state and a post content/destination revision; validate destination health/token and client activity at that write; return 409 on conflict. Approval must use the exact destination/content revision actually reviewed. Test both ordering directions.

### G06 — Stored hashtags never reach the publication payload — P1

**Source:** `cloudflare/src/social.ts`, `publishPostToSocial`; `src/api/client.ts`, `mapPost`; `app/posts/[postId].tsx`.

Generation stores hashtags separately. The normal post mapper/editor does not expose that field, and provider caption/text construction uses only `post.caption`. A mocked Facebook publication with stored hashtags sent none of them. The same caption-only construction appears in the other adapters.

**Close:** define one canonical final-copy renderer, include stored hashtags with deliberate deduplication, let the reviewer inspect/edit the exact outgoing text, and use that renderer in every adapter. Test actual outbound payloads, not just stored values.

### G07 — X silently cuts approved copy — P1

**Source:** `cloudflare/src/social.ts`, X payload construction.

A 500-character approved caption produced a successful outgoing request containing only the first 280 characters. The stored approved caption remained 500 characters. TikTok has analogous unconditional slicing at 2,200 characters. Provider-specific counting is not verified by these probes.

**Close:** validate the final composed copy for the destination before approval/publication, show actionable errors or an explicitly accepted revision, and never silently cut the approved content. Apply provider rules to Unicode, URLs and appended hashtags; test platform boundaries and exact output equality.

### G08 — Larger calendars can starve pre-publish alerts — P1

**Source:** `cloudflare/src/index.ts`, scheduled `upcoming` query, approximately lines 2433–2455.

The query LIMITs the first 100 scheduled/rescheduled rows before checking alert eligibility, with no ordering by alert deadline. With 100 future calendar_scheduled rows plus an imminent rescheduled post, the imminent post received no alert. This scenario reproduced on the migrated fixture. Not every 101-post arrangement fails; the mixed-state ordering demonstrates the bug.

**Close:** filter by computed alert-due time in SQL before limiting, order deterministically by deadline/ID, and drain bounded batches without skipping eligible states. Confirm all due alerts are delivered when ineligible future rows outnumber the limit. Also test alert/due-publish ordering and notification failure recovery.

### G09 — Stale campaign forms overwrite other editors — P2

**Source:** `app/campaigns/[campaignId].tsx`; `cloudflare/src/management.ts`, POST campaign.

Editor A loads original notes; editor B saves new notes; A saves its old complete form. Both writes succeed and B's notes disappear. The existing workflow revision fences only changes during that server request; the server reads the latest revision rather than requiring the one seen by A.

**Close:** send the form's expected revision/ETag and condition on it. Offer reload/merge on 409. Apply the same contract to brand/settings/post editing where multiple writers can overwrite complete forms. Test two real loaded snapshots, not only simultaneous database operations.

### G10 — Derivatives accept arbitrary non-image bytes — P2

**Source:** `cloudflare/src/index.ts`, derivative upload, approximately lines 1541–1600.

A body containing `This is not an image.` with an image/jpeg header was persisted as an analysis derivative. This bypasses the original-upload signature checks and can poison analysis/retries. Original-file signature checks are also shallow; a PNG signature alone is accepted by the fixture.

**Close:** validate bytes and dimensions for supported formats, verify declared MIME against actual content and enforce size before buffering where possible. Do not mark incomplete/corrupt content usable for generation. Keep any intentional support for HEIC distinct from the normalized analysis JPEG contract.

### G11 — Reupload cannot repair an asset whose R2 object is missing — P2

**Source:** `cloudflare/src/index.ts`, original upload deduplication, approximately lines 1485–1506.

Upload once, delete the object from fake R2, then upload the same bytes. The API returns the previous asset ID as deduplicated without checking/repairing the object. This conflicts with creation readiness's instruction to upload a missing image again. The recovery loop never restores the object.

**Close:** verify the object for a hash match; repair/reconcile a missing or corrupt object with the supplied bytes. Add a race-safe unique identity for concurrent identical uploads and an R2/D1 failure cleanup strategy. The missing-object case is reproduced; concurrent duplicate/orphan cleanup is a further source-level risk, not established by that probe.

### G12 — Native localhost fallback uses a removed Expo Constants property — P2

**Source:** `src/api/client.ts`, API_URL resolution; installed `expo-constants` source/changelog.

The code tests `Constants.isDevice`. The installed module removed that property. With the actual missing-property shape, a copied localhost API remains localhost on iOS instead of invoking the claimed physical-device fallback. Standard EAS production/preview profiles explicitly set the correct hosted URL, so this does not prove all standalone builds fail.

**Close:** resolve URLs from explicit build/environment identity, fail closed on invalid release/staging URLs, and preserve only the isolated fixture loopback exception. If device detection is retained, use the supported API and account for any native rebuild. Test web, development, physical standalone, staging, fixture and OTA configurations as a matrix.

Official context: Expo documents physical-device detection under `expo-device`: https://docs.expo.dev/versions/latest/sdk/device/ . The installed `expo-constants` changelog explicitly records removal of `isDevice`.

### G13 — Legacy generation bypasses the newer creation contract — P2

**Source:** `cloudflare/src/index.ts`, POST `/v1/generation-jobs`, approximately lines 1123–1228; compare `cloudflare/src/creation.ts`.

The legacy endpoint remains live. With no OpenAI key, no Brand Brain readiness and no connected destinations, it accepted two identical requests without request keys and created two jobs. The current Create screen uses the newer contract, so this is an older-client/API path rather than its normal submission path. It does not demonstrate bypass of downstream publish safeguards.

**Close:** route supported legacy clients through shared readiness/ownership/idempotency logic, or retire the endpoint with a clear versioned error and migration path. Define legacy compatibility explicitly. No live endpoint should silently evade the intended creation guarantees.

### G14 — Paused recovery silently hides records after 100 — P2

**Source:** `cloudflare/src/workspace.ts`, GET paused; `app/paused/index.tsx`.

With 101 paused posts, the API returned 100 and no continuation cursor. The screen has no pagination/search for reaching the omitted item. This is a recovery completeness issue even though a known deep link may still open that post.

**Close:** add authorized cursor pagination/search/filtering and stable ordering, preserve selection across pages as appropriate, and test finding/restoring an item beyond the initial 100. Review-link histories also have fixed caps; distinguish an intentionally recent history from an actionable work list.

## B. Further source-level gaps requiring targeted validation

These are visible design/implementation gaps; they were not counted as additional successfully reproduced scenarios above.

1. **Provider deadlines and cron isolation — P1.** Many Google/social OAuth, refresh, verification, media initialization/upload and receipt calls have no explicit application deadline. Final publication submission and analytics reads do have deadlines. Add bounded policies to the uncovered calls and avoid letting account-health/analytics work block the minute-by-minute scheduling path. Maintain uncertain-publication handling; never retry an ambiguous final submit automatically.
2. **Refresh lifecycle — P1.** `ensurePostSocialDestination` excludes already expired tokens before `accountToken` gets an opportunity to renew them; scheduled health checks select on a six-hour last-check cadence rather than expiry. Test an otherwise valid refreshable token expiring between health checks and ensure it renews before a scheduled post is blocked. Treat provider 429/5xx refresh failures as temporary, rather than unconditional reauthorization failure as currently implemented.
3. **Long analytics runs — P2.** Manual sync performs per-post/per-account provider work synchronously, while client JSON requests default to 15 seconds. Several slow successes can outlast the caller. Use durable queued sync jobs with progress/polling, coalescing and bounded batches. Check overlapping cron/manual runs and partial failures.
4. **Atomic Brand Brain save — P2.** The screen saves brand and client profile with `Promise.all` across separate endpoints. One can succeed while the other fails. Provide a single transaction or report/reconcile partial saves using canonical state; combine with G01/G09.
5. **Generation list polling — P2.** Refresh merges old jobs with the first matching page. A job leaving the selected status can remain in the old list after the server stops returning it. Reconcile by status/filter and job identity without dropping separately loaded older pages.
6. **Dashboard timezone — P2.** Publishing-today boundaries use Worker-local Date midnight, with no workspace/client timezone choice, while Calendar supports the selected client's timezone. Define and label one dashboard-day policy, return its boundaries/zone, and test UTC midnight and DST against non-UTC workspaces.
7. **Input errors and operational limits — P2.** Several routes accept `any` and call trim on unvalidated fields outside the local error handler. Add common request schemas and a JSON error boundary. Define generation/media/analytics budgets and bounded retention; do not rely only on queue concurrency or publish spacing to limit expensive work.
8. **Exact visual branding — product acceptance decision.** `deterministicComposition` describes a layout passed to the model; generation saves the model result directly. There is no deterministic logo/text compositing step. If exact logo fidelity is part of the intended promise, implement/verify actual compositing rather than treating a prompt contract as a guarantee. Otherwise document the model's limitation and require visual approval.

## C. Dependencies and release acceptance

### Fresh dependency blocker

`npm run audit:dependencies` now stops at GHSA-gcqx-w48m-w2h4 (`deepmerge`). Fresh npm audit reports 8 affected root package entries: 3 high and 5 low. They derive from two leaf advisories; the existing Zod advisory remains. Worker audit reports zero.

The registry result labels the deepmerge entry low; the GitHub advisory page currently describes it as high and unreviewed. Record that discrepancy and verify the actual affected version/path rather than inventing one severity. The baseline's rejection of an unknown finding is working correctly. No exception or dependency override was added here. Do not apply the audit's suggested Expo SDK downgrade blindly.

Primary advisory: https://github.com/advisories/GHSA-gcqx-w48m-w2h4 . Closure requires a compatible remediation and toolchain checks, or an explicit owner-approved, scoped, expiring disposition with mitigations and a validated release gate. Zod's prior incompatible override remains rejected; reassess current compatible releases before changing the baseline.

### Operational evidence still needed

- Obtain a real successful CI result for the release commit and inspect account/build failures using their actual logs. PR #23 being merged is not CI acceptance.
- Provision and verify genuinely separate staging D1, R2, queues, secrets and OAuth callbacks, with explicit admission and publishing holds. Source guards do not prove resources/settings exist.
- Verify actual provider acceptance for each launch provider: account identity/permissions, approved outbound content, duplicate queue handling, revocation, reconnect, throttling, asynchronous receipts, uncertain-outcome reconciliation and analytics limits.
- Complete Android/iOS physical staging acceptance, including real Google returns, uploads/permissions, background/reconnect, push receipt/tap and compatible/incompatible-runtime OTA.
- Perform an actual isolated D1/R2 restoration drill, including media integrity, token decryption and restored-session revocation; use real measured evidence.
- Activate the small supervised pilot only after the code and evidence gates pass, with explicit holds, approved destinations, daily limits, expiry and recorded supervision.

## D. Closure sequence and acceptance rules

### Batch 1 — Data integrity and identity of approved work

Fix G01–G05 and G09; make Brand Brain save atomic. Add tests for exact logos after save, disconnect/reconnect/refresh races, simultaneous destination/approval writes and two stale editor snapshots. **Exit:** revoked connections stay revoked, saved brand identity survives edits, and approved content/destination cannot change without a new review decision.

### Batch 2 — Faithful publishing and scheduler reliability

Fix G06–G08; close uncovered provider deadlines and token-expiry lifecycle. **Exit:** reviewer preview matches actual provider payload, invalid copy is rejected before delivery, all due alerts remain reachable under load, and temporary provider failures have safe recoverable states.

### Batch 3 — Recovery and scale completeness

Fix G10–G14, analytics job handling, list reconciliation, common input validation and timezone semantics. Define media/resource limits and exact branding acceptance. **Exit:** a documented failure has a working recovery path, every actionable item remains reachable past the first page, and environment selection is deterministic across build profiles.

### Batch 4 — Prove closure on the release candidate

Resolve both dependency findings, run the complete fresh browser suite on installed browsers, run 217 existing tests plus corrected regression tests for every new finding, rebuild/package affected targets, obtain green hosted CI, and complete the live/device/restore acceptance matrix. **Exit:** one exact source SHA has complete current evidence, no unresolved P1 issues, and no unidentified or silently deferred P2 feature gaps.

Convert the audit probes to assertions of correct behavior before adding them to the regular suite. Use actual API payload/state assertions and negative/interleaving cases; a passing probe in this audit means the defect was observed.

## Scope boundaries

The app already implements the main workflow, role-based access, invitations, profile editing, review links, recovery controls, AI queues and provider adapters. They are not all placeholders. Conversely, this pass does not promise that no undiscovered defects remain. Closure is defined by explicit functionality contracts, corrected regressions and real acceptance evidence.

Existing provider limitations such as unavailable LinkedIn member analytics must stay visible rather than being represented as zero metrics or a successful supported feature. Billing, CRM, chat and unrelated new product features were not assumed to be part of BrandSparQ's intended scope.

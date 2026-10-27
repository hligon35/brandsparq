# Phase 2 — create, review and publish workflows

## Delivered

- **Single social post:** `POST /v1/creation-jobs` with `mode: social` requests exactly one post, one chosen destination, and a dedicated single-post AI schema. It creates no campaign container.
- **Campaign:** the same creation API accepts `mode: campaign`, exactly 3, 4 or 5 total posts, and one account per chosen platform. The output must include every selected platform and use no unselected platform. Every generated post retains its chosen social account.
- **Readiness:** Create checks an active client, valid time zone, Brand Brain voice/audience, generation configuration, usable connected destinations/provider configuration, owned image sources and storage existence. A selected logo must be a valid stored client image. A logo is optional. Issues link to Brand Brain and Social Connections and can be refreshed before submission.
- **Upload recovery:** images can be added and individually removed. Three workers retain completed uploads and original IDs after derivative failures. Failure is reported only after every worker settles; retry processes only incomplete images. Client/mode/objective/destination/count controls stay fixed during submission. Discarding an in-progress form prevents a later upload completion from creating content or navigating the user back into the workflow.
- **Ambiguous creation:** a lost response leaves an explicit Retry creation request action that reuses the exact request, uploaded asset IDs and request identity. Definite client errors unlock the form for correction. Existing Phase 1 durable dispatch failure/retry behavior is preserved.
- **Generation progress:** a requested job is fetched directly and merged with recent jobs, including jobs older than the recent fifty. Single-post jobs link directly to their post. Campaign jobs link to the campaign.
- **Destinations:** Social Connections can choose a default account per client/platform, atomically. Reconnect guidance covers expired and disconnected accounts. A pinned destination that becomes unavailable is never silently replaced with another account. Approval checks ignore expired/unhealthy accounts.
- **Publishing controls:** completed, failed, queued, publishing and provider-processing states explain the next step and omit invalid publishing actions. Approved paused posts expose Resume. Campaign delivery restrictions suppress Publish now. Existing server/pilot safeguards remain authoritative.
- **Navigation/layout:** shared buttons forward link props so clean links navigate correctly and retain link semantics. The expanded Create form uses natural column heights on phones to prevent overlapping controls.

## Campaign semantics

| Setting/action | Effect |
| --- | --- |
| Active | May approve, reserve and deliver posts inside its delivery window. |
| Draft, paused, completed, archived | Cannot create new reservations or claim publishing work. Cron holds due posts. An existing provider claim is preserved. |
| Start/end | Restrict reservations and delivery. Date-only values use the client time zone; the end date includes that entire local day, including daylight-saving changes. Timestamp values represent exact instants. |
| Priority | Orders campaign lists highest first. It never bypasses calendar spacing or daily caps. |
| Approve ready posts | Approves eligible review posts through the existing authorization/destination/reservation path. |
| Pause scheduled posts | Pauses eligible unclaimed scheduled/queued posts and invalidates their old executions. |
| Resume approved paused posts | Requires an active campaign, then reserves each eligible post using the shared transactional scheduler. |
| Cancel scheduled posts | Cancels eligible scheduled/paused posts, preserving published posts and active publishing claims. |

Bulk actions require confirmation, preserve unsaved campaign edits, and report each update/skip/failure. They process at most 100 posts per request; larger campaigns must use smaller Calendar selections. Campaign metadata changes advance the workflow revision and client calendar epoch, fencing racing reservations and publisher claims. Status changes do not recall a provider submission already underway.

## API and compatibility

The new creation request requires `clientId`, `mode`, `outputCount`, `objective`, `assetIds`, `destinationIds`, and a stable `requestKey`. Creation identities cover all those content choices. Replays return the accepted job even if readiness has since changed. Invalid provider plans are rejected before persistence and can be generated again on retry.

The older `/v1/generation-jobs` creation endpoint retains its legacy campaign/draft contract for older installed clients. New Create submissions exclusively use the explicit readiness-checked contract. Both job types share the existing claim, job retry, approval and publishing safeguards. Choosing or changing a default affects future unassigned content; it does not rewrite destinations on existing posts.

## Migration and release

This branch depends on Phase 1 (PR #17). Apply `0024_phase_one_workflow.sql` and then **`0025_creation_workflows.sql`** before deploying this Worker/app version. Migration 0025 adds persisted creation options and the campaign workflow revision; no content is removed.

There are no package, native dependency or app configuration changes. A compatible installed runtime can receive the app changes through the existing OTA channel after the backend migration/deployment passes staging and release gates. No production deployment or migration is included in this implementation.

## Verification

- Backend suite: **177 passed**, including **20** new Phase 2 tests.
- Tests cover exact single/campaign contracts, destination isolation/pinning, invalid output retry, request identity/concurrency, readiness/storage errors, default races/permissions, campaign windows/DST/revision races, bulk results, stale job links, upload-worker interleavings and state-dependent publishing actions.
- Root/Worker TypeScript, lint, formatting, schema manifest, launch audit and Expo compatibility checks pass.
- Web and iOS/Android JavaScript exports pass.
- Full desktop/phone Chromium suite: **80 passed**. After the final upload cancellation fix, **4 additional desktop/phone recovery checks passed**, covering derivative retry and leaving during an upload.

Fixtures isolate the database, media, queues and providers. Live provider acceptance and installed-device acceptance remain in Phase 4; these tests do not represent actual social publication. Hosted CI and production release status are reported separately from local verification.

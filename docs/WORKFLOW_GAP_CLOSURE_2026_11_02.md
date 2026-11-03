# Workflow gap closure — November 2, 2026

## Implemented

- Review API and dashboard counts include `edit_requested` alongside `awaiting_approval`. Client workspaces consume the same review API.
- Analytics rejects a different range while an account has an active job, with the active/requested ranges and a retry instruction. Equal ranges still coalesce; validation also applies before reuse. A concurrent insert is checked before returning a job.
- Meta import resolves all client assignments and checks archived targets before any account writes. Runtime failures after persistence return an explicit partial count and a client link; reconnect retains the existing account identity/revision safeguards. Mobile refreshes the account list before reporting partial failure. This is recoverable partial completion, not an all-or-nothing transaction across the full import.
- Public review forms use the shared unsaved-change navigation/refresh guard. The API returns client timezone and the review screen labels and formats suggested publication time in that zone.
- Staging no longer inherits production Meta IDs. Meta is disabled by default. Supply `BRANDSPARQ_STAGING_META_APP_ID` and optionally `BRANDSPARQ_STAGING_META_LOGIN_CONFIG_ID` in `.env.sandbox`; provision the matching staging `META_APP_SECRET` separately. Production IDs are rejected. Generating config does not provision secrets or change deployed Workers.

## Verification

Four new backend regressions cover review reachability, analytics range reuse, preflight rejection of archived assignments, and explicit partial persistence results. Existing tests retain first-write rollback and connection-revision conflict assertions.

## Remaining from the functionality audit

- Complete browser acceptance of public unsaved-change handling and timezone display, including mobile WebKit.
- Page-dependent Meta account discovery remains the supported integration. Standalone Instagram grants are not implemented by this change; live configuration/permission acceptance is still required.
- Meta webhook deliveries are recorded but need a defined event-processing contract and handlers.
- Review/Calendar retrieval still needs authorized SQL filtering, bounded retrieval, and compatible client pagination.
- Signed post previews need renewal that preserves unsaved editor content.
- Provider photo expiry recovery, live provider acceptance, physical Android/iOS acceptance, hosted CI, restoration and supervised pilot evidence remain unverified.

No migrations, native dependencies, production deployment, OTA, social posts or pilot activation are included.

## Follow-up: bounded post lists and preview recovery

- Review and Calendar now authorize client membership in SQL before paging. Requests return up to 100 rows with an ID continuation cursor. Existing app callers follow all pages, deduplicate IDs, reject cursor loops, fence session changes, and restore chronological display order. This bounds each server request; the screens still collect the complete result into memory, so UI virtualization/incremental rendering remains future scale work. Legacy callers that omit pagination parameters receive an explicit update-required response when the list exceeds one page, rather than a silently incomplete list.
- Calendar validates dates, enforces increasing bounds and a maximum 93-day window, and normalizes accepted bounds to UTC ISO strings. The current 42-day grid and client workspace 30-day summary fit this contract.
- Post image failures trigger one automatic URL renewal and expose a manual retry on continued failure. Renewal updates only the image URL and preserves unsaved headline/caption and the original content revision. Native/browser acceptance of this component is still required.
- Added regressions for page traversal beyond 100, access filtering before limits, date boundaries and invalid ranges, legacy unpaged responses, and repeated cursors.

Meta event processing and standalone Instagram login support remain open. No webhook behavior is changed by this follow-up.

## Follow-up: durable Meta webhook reconciliation

Migration `0030_meta_webhook_jobs.sql` adds processing state, bounded attempts, lease fencing and an inbox recovery index. Apply migrations before deploying this Worker.

- Valid signed deliveries persist as pending before queue dispatch. A queue send failure does not lose the event; minute maintenance retries pending unclaimed work.
- Page/Instagram deliveries identify matching connected accounts belonging to active clients. The job verifies those accounts against Meta using existing connection-revision fences and refreshes profile metadata. Payload values never directly authorize publishing, reconnect disconnected accounts, modify posts, or assert publication receipts.
- Unknown objects and unmatched identities are explicitly ignored. This is account-health reconciliation, not a comment/DM inbox, semantic permission event parser, analytics trigger or provider publication confirmation.
- Duplicate deliveries share a durable inbox row and queue claim. Processing has a five-minute lease, at most five attempts, a one-minute failure delay and a maximum ten matched accounts per delivery. Oversized batches fail visibly rather than silently skipping accounts. Payloads are capped at 256 KiB and 100 entries.
- Owners can inspect paginated processing status and retry failed jobs in System Health → Meta webhook jobs. The API excludes raw payloads and denies nonowners. Historical webhook rows remain `recorded`; they are not replayed automatically.
- No new native dependency or build configuration is introduced. Remote migration, webhook subscription, live provider acceptance, device testing and deployment remain outstanding. Standalone Instagram Login is still not implemented; current Instagram connections use the Page-linked Meta flow.

## Follow-up: public review action integrity

Public Request changes and Regenerate now save the visible edited headline/caption with the expected revision before performing the action. Approval/save/reject/regenerate share persistence logic; if a follow-up action fails after the save succeeded, the editor retains the new revision for a safe retry. Failed regeneration preserves the instruction. A late save from a different review link is rejected locally.

Public headline, caption and feedback controls are disabled while regeneration polling is active; polling can no longer overwrite newly typed changes in those fields. Approval and other mutation controls are also blocked during regeneration.

New browser regressions cover request-changes persistence, approval retry after a simulated provider outage, failed regeneration preserving copy/instruction, and signed preview renewal preserving an unsaved caption. Chromium desktop/mobile acceptance is recorded after the run below; physical iOS/Android and WebKit remain separate gates.

Standalone Instagram Login remains open. Meta's available official collection distinguishes Instagram Login permissions from Facebook Login, but the directly referenced authentication documentation returned HTTP 429 during verification. No partial direct-login adapter was shipped or represented as supported.

Verification for this follow-up: 314 unit/backend tests passed; 8 targeted browser cases passed across desktop/mobile Chromium; TypeScript, lint and formatting passed. The standard Chromium download was invalid; the same official Chrome-for-Testing headless build was obtained from Google's storage endpoint. Browser tests used freshly exported app source and the isolated authenticated fixture API. These are not real provider/device acceptance.

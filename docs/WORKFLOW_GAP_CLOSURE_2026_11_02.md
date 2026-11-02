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

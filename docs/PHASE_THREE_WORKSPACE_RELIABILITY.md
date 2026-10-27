# Phase 3 — workspace reliability

## Scope delivered

### Analytics

- One canonical latest-sample join, ordered by capture time and SQLite insertion order, prevents same-second double counting. Legacy empty samples are ignored.
- Provider failures and malformed responses never replace good measurements. Individual post failures retain their previous samples while successful posts retain new samples; the account run reports failure and the UI surfaces partial account results. Requests have a 15-second deadline.
- LinkedIn member analytics explicitly report `unsupported`. Organization analytics remain supported. Refresh no longer stops silently after fifty published posts.
- Missing metrics remain null, measured zero remains zero, and coverage is shown per metric. Overview reports unavailable, partial, stale or current measurement status, with oldest/latest capture times and provider failure history.
- The selected range means **posts published during the selected 7, 30 or 90 UTC calendar days, including today**. Totals, platforms and rankings show the latest lifetime measurements for that cohort. Trend points use the same cohort and only measurements available by that UTC day. This is not engagement earned solely within that date range. Empty trend points remain unavailable.

### Personal preferences and account management

- Every active member can edit their own notification channels and alert-type preferences. Workspace scheduling, pre-publish timing and no-response policy remain owner controls.
- The scheduler reads client overrides and workspace publishing defaults; an owner's personal alert settings no longer determine publishing behavior or multiply scheduler rows when multiple owners exist.
- Older owner clients sending publishing policy in the notifications payload are translated to workspace controls, with owner authorization. Legacy policy reads reflect current workspace defaults. Omitted preferences remain unchanged.
- Existing owner promotion now has explicit confirmation. Owners can step down after another active owner exists; the server retains its conditional last-owner protection. Access changes refresh the current session immediately. Foreground and periodic session refresh updates role/client capabilities, with stale-session responses fenced across sign-out.
- Invitation pages offer account switching. Real Google account-selection acceptance remains a Phase 4 provider/device check.
- Profile load failure has persistent retry. Profile changes and unverified email edits have navigation/refresh protection; verifying email preserves other unsaved profile fields.

### Drafts and navigation

- Profile and Create drafts are scoped to the signed-in user. Browser drafts use session storage; installed-app drafts use device-only encrypted SecureStore chunks. The manifest is committed after all chunks, and writes are serialized.
- Create stores image references and upload progress without copying browser image bytes into draft storage, and saves the exact creation request and request key before submission. An unconfirmed response can be recovered after reload and replayed without duplicate generation or another image upload.
- Fully uploaded images are reusable. Browser photo blob URLs cannot survive a reload: photos that were not fully uploaded must be reattached. Native temporary photo files can also expire; the retained draft and upload errors allow correction.
- Shared unsaved-change guards also protect browser refresh/close. Discard cancels late Create submission.
- Notification destination navigation proceeds immediately, independently of saving read status; the item remains new and an error is shown. New native push payloads carry the inbox notification ID; accepted taps mark that item read independently of navigation. Foreground pushes refresh inbox state.
- Header unread badge counts the complete authorized inbox, with foreground and periodic refresh. Notification actions refresh it immediately.

### Histories and lists

- Generation history and notifications have bounded keyset pagination, stable timestamp/ID ordering, server-side search and status filters. Invalid cursors and limits fail validation. Every page retains client/user authorization.
- Requested generation-job deep links still load independently of the first page. Polling preserves loaded history pages.
- Notification unread totals cover the full inbox. Select/delete batches remain bounded to 100; the UI explains that limit.
- Client and campaign directories have search and incremental rendering; those existing endpoints still return the complete authorized directory. Calendar remains date-window based and review retains its existing search workflow.

## Migration and deployment order

1. Merge/apply Phase 1 and Phase 2, including migrations 0024 and 0025.
2. Apply **0026_personal_preferences.sql** before this Worker. Its schema marker is included in admission checks, so an unmigrated database fails admission.
3. The migration conservatively consolidates existing active-owner preferences: any hold or unknown policy retains a hold, skip takes precedence over auto-publish, and the largest existing alert lead time is retained. Explicit client overrides remain in force. Inspect the resulting workspace policy before release.
4. Deploy Worker and compatible application assets through the established release gates.

No native dependency or app configuration changed. Existing matching runtimes can receive JavaScript updates through the established OTA process. No deployment, migration, OTA or provider publication was performed during implementation.

## Verification

- 192 backend tests passed, including 15 new Phase 3 regressions.
- 102 desktop/phone Chromium browser checks passed. After final draft compaction, six additional upload-recovery checks passed (derivative retry, leaving during upload, and unconfirmed-request reload/replay on desktop and phone).
- Root/Worker TypeScript, schema, lint, formatting, launch audit and Expo compatibility checks passed. Final web and Android/iOS JavaScript exports passed.
- The dependency audit matched the existing reviewed baseline: Worker zero vulnerabilities, root four tracked high-severity findings. The audit script accepts that tracked baseline, but reports `securityClear: false`; no dependencies changed and security clearance is not claimed.
- Installed Android/iOS acceptance, real provider OAuth/analytics/push behavior, hosted CI, staging deployment, restoration and supervised pilot activation remain Phase 4 release gates. Phone Chromium emulation and native JavaScript exports do not substitute for device acceptance.

## Operational limits

- Provider metrics are lifetime counters, not interval event counts. A total with partial coverage must not be interpreted as a complete account total.
- Browser drafts share the lifetime of the browser session; private browsing or unavailable device storage can prevent draft persistence and the UI reports that condition. Native drafts larger than the bounded local storage allowance report a save error while navigation protection remains active.
- Notifications generated before this change do not contain the inbox ID in their push payload; opening the in-app inbox still supports marking them read.

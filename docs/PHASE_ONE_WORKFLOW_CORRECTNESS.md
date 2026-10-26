# Phase 1 — workflow correctness and configuration reliability

## Implemented

| Area | Change |
| --- | --- |
| Keep schedule | Conditional state/version write; requires approval and a saved schedule. A paused post uses Resume. Published posts, receipts and active publisher claims cannot be overwritten. Failed transitions return 409 and create no success audit. |
| Resume and cancellation | Resume uses the same transactional calendar reservation as approvals and rescheduling. Concurrent resumes respect spacing and daily limits. Paused cancel/restore checks the version and cancels obsolete queued executions transactionally. |
| Publish and recovery | Publish Now and failed-post retry acknowledge only successful conditional transitions and retain the expected execution version. Cron alerts/hold/skip/enqueue actions are version fenced. Unknown stored no-response policies hold publishing closed. |
| Settings | Server checks IANA time zones, integer bounds, time-window syntax, policy values and notification booleans before any write. Client creation/editing also validates time zones. Rule changes advance calendar epochs; omitted preferences remain unchanged. |
| Generation creation | Creation accepts a user-scoped request identity, enforces payload identity and inserts only one job for concurrent requests. The Create screen retains its exact pending request after a lost response, avoiding another upload and campaign on resubmission. |
| Queue handoff | The persisted job is durable. Initial send failures return the saved job as accepted with an explicit failed state/error, so Generation progress can retry it. Late send failures cannot fail a claimed/completed job or a newer retry. |
| Generation workers | Planning/campaign/post/graphic writes are fenced to their active claim. Recovered planners and graphics cannot overwrite newer work. Rendering state is persisted before dispatch, and finalization cannot complete a canceled/retried job. |
| Operator reconciliation | System Health lets an owner record an existing provider post ID or verified absence with mandatory evidence. Decisions, actor, version and evidence are recorded atomically and visible in the screen. Reconciliation never sends content. Verified absence enables a separate explicit retry; unresolved outcomes and contradicting receipts remain blocked. |
| Late provider results | Receipt persistence checks the post version and reconciliation identity. Late results retain their receipt and raise a critical incident without replacing the owner decision. Receipt checks cannot update an unrelated/newer post; known successful/in-progress receipts block publishing claims and retries. |

## Settings contract

- Pre-publish lead time: integer 1–10,080 minutes.
- Minimum spacing: integer 1–1,440 minutes.
- Daily cap: integer 1–100 posts.
- Analytics refresh: integer 1–168 hours.
- Policies: `auto_publish`, `hold`, `skip`.
- Windows: up to 24 `HH:mm-HH:mm` strings, 24-hour times, distinct start/end. Overnight ranges are supported. Empty lists retain unrestricted/no-blackout semantics.
- Time zones must be recognized by `Intl.DateTimeFormat`; empty, malformed and null explicit values are rejected.

## Operator procedure

1. Open the correct provider account and check the ambiguous submission.
2. In System Health, choose **Reconcile outcome**.
3. Choose **Published** and enter the provider post ID, or choose **Verified absent**.
4. Record the account, time checked, URL or verification details in the evidence field (20–4,000 characters).
5. Confirm the decision. The verified outcome appears in the evidence history.
6. If absence was verified, correct any provider/account issue before choosing the separate **Retry** action. An unresolved outcome or existing successful/in-progress receipt cannot be retried.
7. A `late_publish_result` incident requires checking the retained provider receipt before further action.

These are operator assertions, not automated live-provider verification. Existing pilot holds and destination restrictions still apply.

## Migration and deployment

Apply `cloudflare/migrations/0024_phase_one_workflow.sql` before deploying the Worker. It adds generation request/control identities, the unique request index, a post reconciliation identity, and graphic claim tokens. Existing rows retain null identities; no content is removed.

Use the existing staging migration/deployment workflow first. Production migration, deployment and Expo update remain subject to the existing release evidence and hold gates. There are no native dependency or app-configuration changes in this phase; a matching installed runtime can receive the app changes through the existing OTA workflow.

## Verification

- `npm test`: **157 passed**, including 37 new Phase 1 regression cases.
- Root and Worker TypeScript checks, lint, formatting, schema manifest check, launch audit and Expo dependency compatibility check passed.
- Web export and Android/iOS JavaScript exports passed.
- New reconciliation flows passed in desktop and phone Chromium.
- Full desktop/phone Chromium browser suite: **68 passed**. WebKit was not accepted in this environment because its system libraries were unavailable.

Tests use isolated SQLite/R2/queue/provider fixtures. No production migration, live provider submission, actual restoration, installed-device acceptance or pilot activation was performed. Live provider/device/release evidence belongs to the subsequent acceptance phases.

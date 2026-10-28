# Gap closure — Phase 2: publication copy and scheduling

## Implemented

- Shared final-copy rendering combines captions and hashtags, removes duplicate appended tags and preserves the caption exactly. Both installed-app and public-link review expose the complete outgoing text as one editable field. Saving this field clears the separate tag list, so removed tags cannot reappear during publishing. Empty edits are saved faithfully and cannot be approved as empty publication copy.
- Facebook, Instagram, LinkedIn, TikTok and X adapters consume that shared copy. Silent X/TikTok truncation was removed. Single approval reports a copy-length error; the shared scheduling reservation also rejects invalid copy for bulk/campaign/public approval. Delivery revalidates old approved records before any provider side effect.
- Standard posting budgets are enforced for the configured adapters. X URL tokens count as 23 and emoji graphemes as two when Intl.Segmenter is available. The Unicode implementation is deliberately conservative, with a code-point fallback on native engines without Segmenter; it can reject some otherwise valid provider text. It is not an implementation of every premium/extended provider limit. Actual provider eligibility and Unicode edge cases remain live acceptance checks.
- Pre-publish selection filters by computed alert deadline before applying the 100-row limit and orders by deadline and ID. Future posts in another state cannot starve an imminent alert. If recording an alert fails, its guarded marker is reset for a subsequent cron, without overwriting a concurrent schedule/state change.
- Social and Google network calls use bounded headers-and-body reads, with cancellation even for transports that ignore abort. Final publication still treats a lost/invalid submit response as uncertain and non-retryable; adding deadlines does not authorize an automatic repost.
- Expiring refreshable tokens renew before creation readiness or destination selection excludes them. Maintenance also selects accounts near token expiration rather than relying only on the six-hour verification cadence. Phase 1's distributed refresh lease and connection fences remain in force.
- Scheduling handles due work before maintenance. Actual scheduled invocations hand maintenance to ExecutionContext.waitUntil, so a slow health/analytics/notification-retry query cannot block the due-work path. Durable analytics jobs and bounded maintenance pagination remain Phase 3 work.

## Verification

244 Node tests passed: 234 prior tests and 10 Phase 2 regressions. Coverage includes outbound Facebook copy with hashtags; complete-copy limits/Unicode/URLs; over-limit X rejection before external effects or approval; expired-token renewal; imminent alerts beyond 100 future rows; stalled response bodies; uncertain final submission; retry after an alert-outbox failure; exact whitespace/tag removal; and isolation from stalled maintenance.

Root and Worker TypeScript, lint, formatting, schema and launch checks passed. Web export and Worker packaging dry run passed. Browser/physical-device acceptance was not completed: the browser runtime remains unavailable in this environment. No live provider posting or production deployment was performed.

## Release handoff

This phase adds no migration or native dependency. Phase 1 migration 0027 remains required before using the new revision-aware Worker/client. Update client JavaScript and Worker together through staging and the existing guarded release process. No source holds, dependency exceptions or acceptance gates were relaxed.

Outstanding later-phase work includes image repair/validation, legacy generation consistency, pagination, durable analytics, API-origin configuration, dependency remediation, complete browser/native/provider acceptance, restoration and green hosted CI. This phase does not constitute production acceptance.

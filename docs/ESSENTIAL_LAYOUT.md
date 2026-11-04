# Essential workspace layout

The Essential design uses white bordered surfaces, compact blue actions, smaller
page headings, consistent form controls, and a clear five-destination navigation.
Shared components and theme tokens apply the treatment to secondary screens,
dialogs, Brand Brain, review, analytics, access, profile, settings, and recovery.

## Main screens

- Home uses three centered statistics, three icon shortcuts, upcoming content,
  and personal recent activity from the authenticated API.
- Clients keeps the profile image and name together, previews three lines of
  brand voice, and opens a responsive Add client dialog. Archive remains available.
- Create retains readiness checks, platform destinations, source uploads,
  objectives, draft recovery, and generation controls in a compact form.
- Calendar uses the searchable client selector, period navigation and segmented
  day/week/month views. Search, platform filters and bulk scheduling remain available.
- More uses equal-height tiles in two columns, including Review queue. Owner-only
  access management and system health retain their authorization requirements.
- Social connections retains the previously selected compact list and icon glow.

## Remove a client

Client managers can choose **Remove** on a client card and confirm the named
client. This differs from Archive: removed clients do not appear even when archived
clients are shown, and the restore endpoint cannot restore them.

`DELETE /v1/clients/:id` requires the exact current client name as `confirmName`.
Permission and active user status are checked again inside the removal transaction.
Publishing, provider processing, AI processing and unresolved publishing outcomes
block removal. A publisher claiming between the initial read and the transaction
also blocks it without canceling the claimed job.

Successful removal atomically marks the client removed, cancels pending work,
disconnects stored social credentials, advances connection and edit revisions,
revokes review and post media links, disables reviewers, removes client access,
and records an audit action. All dependent writes require the unique removal token.
Client and related history remain in the database for audit purposes; this action
does not erase stored media or delete posts from external social platforms.

Removed client scopes are excluded from normal owner/member workspace queries.
Existing Meta account associations cannot silently resurrect a removed workspace;
the callback explains how to connect explicitly from a new client instead.

The existing client status field supports this lifecycle; no new migration or
native dependency is required. Deploy the Worker and web assets together. Native
delivery must use the installed app's compatible update channel/runtime or a new
build according to the existing release process.


## Settings app updates

The App updates section is first in Settings and is available even when settings
cannot be loaded. In an update-enabled standalone iOS/Android build it checks for
compatible updates, downloads them, and exposes **Restart and update**. A separate
restart confirmation and the existing unsaved-settings guard must both succeed.
Previously downloaded updates are recognized; canceled restarts and restart errors
keep the update available. Disabled/development builds explain why OTA is unavailable.

The action uses the installed build's existing Expo update configuration. It does
not override a channel, runtime, update URL, or deployment/acceptance setting. A
compatible update must first be published through the normal EAS release process;
this button does not publish updates or replace incompatible native binaries.
On the web, **Refresh web app** confirms a page reload and protects unsaved changes.

Reference: https://docs.expo.dev/versions/latest/sdk/updates/

## Secondary screens and shared Health

The follow-up applies individual Essential layouts to every secondary mobile route:
review queue, post and public review, publish/reschedule, client workspace, Brand
Brain, reviewers, campaigns and campaign details, generation/paused recovery,
analytics, notifications, profile, access management, settings and System Health.
Invitation, sign-in and not-found surfaces use compact entry/recovery styling.

- Brand Brain groups fields into Voice & audience, Visual direction, and Content &
  publishing rules. Disclosure sections keep children mounted so closing them
  preserves unsaved edits, validation and existing navigation guards.
- Review and campaign lists use smaller content-driven cards. Progress and paused
  recovery use separated rows in one list surface. Publishing shortcuts are compact.
  Review previews contain the full image instead of cropping its edges.
- Analytics focuses on measurements, trends, platform comparisons and top content.
  Its searchable client picker replaces the long client-chip strip. Metric semantics
  remain available under About these measurements, including the difference between
  missing measurements and a measured zero.
- More → System health is available to every signed-in role. Analytics links there
  with its selected client. Connections, analytics job history and provider sync
  errors live together. Active/problem jobs appear first; completed jobs are behind
  Show sync history, with incremental display of the latest 100 jobs. Provider run
  details are expandable and limited to the latest 50 authorized records.
- Owner readiness, publishing controls, certification, incidents, reconciliation,
  queue recovery and webhooks remain on that same screen. They are rendered only
  for workspace owners and retain their existing server-side authorization.
- `GET /v1/analytics/health` exposes only authorized, non-removed clients' sync runs.
  It supports an explicitly authorized client filter and requires no migration.
  Existing analytics-overview response fields are retained for compatibility.

The added acceptance cases cover secondary phone/tablet widths, collapsed-form
state preservation, analytics-to-health navigation and viewer/owner separation.
Browser tests use the isolated fixture API, never client production destinations.

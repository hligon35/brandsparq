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

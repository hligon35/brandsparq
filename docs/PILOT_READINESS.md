# BrandSparQ release and supervised pilot

Evidence date: October 20, 2026. Branch: `fix/pilot-readiness`.

## Status and release conditions

Code fixes and local checks do not certify a live deployment. No staging resources,
provider posts, production backup restore, device results, or client invitations
have been created by this change. The pilot is **blocked** pending the live evidence below.

PR #5 initially triggered CI run 39518116911. GitHub refused to start the job
because the account is locked due to a billing issue. No CI steps ran; this is
not a green CI result. The runner is pinned to Ubuntu 24.04 for the existing
Playwright version rather than following the Ubuntu 26 `ubuntu-latest` migration.

| Gate | Evidence required | Current state |
| --- | --- | --- |
| Code | Green CI on the exact release commit | GitHub job refused to start: account locked due to billing issue |
| Dependencies | Expo compatibility check and reviewed advisory disposition | Compatibility aligned; see DEPENDENCY_ADVISORIES.md |
| Staging | Separate D1, R2, queues, secrets, OAuth apps and correct host | Configuration tooling ready; Cloudflare authentication absent |
| Access | Anonymous routing probes, OAuth round trip, webhook and provider media retrieval | Not verified live |
| Providers | Approved test destinations, provider IDs, confirmation and analytics | Not verified live |
| Restoration | D1 restore plus R2 checksum inventory from an actual backup | Verifier tested with fixtures; actual backup unavailable |
| Native | Android and iOS device evidence, OAuth, uploads, push and session lifecycle | Maestro/device runner and EAS project required |
| Pilot | All above gates resolved, operator and client list recorded | Not started |

## What changed

Both Brand Brain logo fields now require an image belonging to the same client;
graphic generation independently enforces that ownership when loading a logo.

Pausing and scheduler hold/skip now transition the post and cancel queued jobs in
one D1 transaction. Once a publisher has claimed the job, pausing fails explicitly.
Scheduler alert and queue updates cannot overwrite a paused or terminal state.
Stale in-flight publishing is held with `PUBLISH_OUTCOME_UNKNOWN`: reconcile at
the provider before creating replacement content. Unsent queued jobs remain recoverable.

Past requested or AI-proposed dates are moved into a future valid slot. AI caption,
image and regeneration requests create durable `revision_jobs` and return a job ID
immediately. The generation queue performs the revision; cron recovers unsent jobs.
Duplicate deliveries cannot run a second writer. Failures return the post to edits;
timed-out revisions require inspection before another revision. Review screens poll
while regenerating, including public review links.

Apply migration `0019_revision_jobs.sql` **before** deploying this app and Worker.
`npm run schema:check` verifies the generated schema manifest against every ordered
migration. Launch certification checks all tables, column definitions, explicit
index definitions and foreign-key integrity; schema gaps return `blocked` before
queries that require those gaps. Production and staging certify their own origins.

## Isolated staging

Authenticate Wrangler to the intended account first. Record its actual workers.dev
subdomain; do not assume it is `hligon`. Create these resources in that account:

- Worker: `brandsparq-staging`
- D1: `brandsparq-staging`
- R2: `brandsparq-staging-media`
- Queues: `brandsparq-staging-publish`, `brandsparq-staging-generation`
- DLQs: `brandsparq-staging-publish-dlq`, `brandsparq-staging-generation-dlq`

Use `wrangler d1 create`, `wrangler r2 bucket create` and `wrangler queues create`
for the names above. Save the resulting D1 UUID. Create a separate Google OAuth
app with the staging callback, separate social provider test apps/accounts, and
new auth/token secrets. Do not import production users, social tokens, recipient
addresses or OAuth secrets. Only test destinations and test email recipients belong
in staging. Set workspace no-response policy to `hold` during acceptance.

Create the ignored `.env.sandbox` with:

```dotenv
BRANDSPARQ_STAGING_ORIGIN=https://brandsparq-staging.ACCOUNT.workers.dev
BRANDSPARQ_STAGING_DATABASE_ID=the-new-staging-D1-UUID
BRANDSPARQ_STAGING_GOOGLE_CLIENT_ID=the-separate-staging-OAuth-client-ID
```

The values above describe required inputs, not usable credentials. Then:

```bash
npm run configure:staging
npm run migrate:staging
# Provision the required secrets listed in PRODUCTION.md using:
# npx wrangler secret put SECRET_NAME --config cloudflare/wrangler.staging.toml
npm run deploy:staging
```

Run secret commands from the repository root with the explicit config path.
Staging deployment always uses the separate generated configuration; it rejects
the production D1 UUID, OAuth client and origin. It contains no production routes.
Confirm every binding in Wrangler's dry-run/deploy output before accepting it.
The production deploy command remains unchanged.

After deployment set `BRANDSPARQ_BASE_URL` to the verified staging origin and run
`npm run smoke:staging` and `npm run smoke:routing`. Run owner launch certification
and save the result with the deployed commit and Worker version.

## Access routing contract

Live probes on October 20 returned HTTP 302 redirects to the Cloudflare Access
login for `/v1/dashboard`, `/v1/public/review/invalid-acceptance-token`,
`/v1/public/invitations/invalid-acceptance-token`, and
`/v1/public/publish-media/invalid-acceptance-token`. The provider-media and public
review endpoints are currently gated before reaching the Worker. Account policy
changes remain unperformed because Cloudflare authentication is unavailable.


The Expo app uses application sessions and client authorization. Browser-only
Cloudflare Access on the entire origin or all `/v1/*` breaks native clients,
OAuth callbacks, review links and provider downloads. The native app must never
contain Access service credentials.

Use the main application host with its existing Worker session and authorization
guards. Keep administrative infrastructure behind a separate Access-protected
management host. If retaining a browser Access application on the main host,
configure explicit public paths and a supported native authentication strategy
before accepting it; a service-token smoke pass alone does not certify native access.

| Route | Required behavior without an Access service token |
| --- | --- |
| `/login`, `/review/*`, `/invite/*`, `/_expo/*`, `/assets/*`, `/favicon.ico` | Public shell/assets; private data still requires application authorization |
| `/v1/auth/*` | OAuth and session handoff reach Worker; state and handoff validation remain mandatory |
| `/v1/public/*` | Reach Worker; signed/review/invitation tokens enforced by Worker |
| `/v1/social/{meta,linkedin,tiktok,x}/callback` | Reach Worker; OAuth state validated |
| `/v1/social/webhooks/meta` | Reach Worker; verification token/signature enforced |
| `/v1/dashboard` and other private APIs | JSON 401 without an application session |
| `/health` | Minimal JSON dependency health; detailed checks remain owner-only |

`smoke:routing` deliberately sends no Access service credentials and does not follow
redirects. It probes private app guards and invalid public tokens. Also test real
callback state, webhook signatures and provider retrieval; probes alone are partial
coverage. Apply account-level Access changes only after reviewing existing policies.

References: [Cloudflare application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
and [path-specific bypass policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/).

## Live provider acceptance

Use one named operator and explicitly designated test destinations. For every
provider included in the pilot (Instagram, Facebook Page, LinkedIn member or approved
organization, TikTok, X), record these results on the exact staging release:

1. Connect, verify destination identity and assign it to the intended client.
2. Upload an image, generate content, revise it, inspect the result and approve.
3. Publish a labeled test post; capture the job execution key, provider post ID,
   final status, timestamp and destination URL. Confirm provider-processing receipts
   reach publication before claiming success.
4. Deliver a duplicate queue message; verify only one provider post exists.
5. Pause before publishing, exercise a provider rejection/rate limit and test an
   uncertain outcome. Reconcile uncertainty manually; never blindly repost.
6. Verify review email, token expiration/revocation, prepublish hold, push and an
   analytics snapshot. Test webhook signature failure and duplicate delivery.
7. Disconnect/reconnect and verify expired credentials produce readable recovery.

Keep credentials, review tokens and recipient personal information out of the PR.
A provider absent from acceptance must remain out of the pilot's supported scope.
No real client publishing should be enabled by an unrecorded test assumption.

## Backup restoration

Export D1 using `wrangler d1 export` with an explicit production config and a local
output file. Capture a contemporaneous table-count inventory and a complete R2
object inventory, including generated graphics and referenced source/logo objects.
Download objects through an authorized S3-compatible client and retain SHA-256
checksums. Store backups privately; exports contain personal data and encrypted
provider tokens. Keep the corresponding encryption keys available through the
secret manager, never in the snapshot manifest.

Restore D1 into an isolated restore database, with no scheduled consumers or live
provider secrets. Restore R2 into a separate restore bucket. Verify row counts,
constraints, media bytes and decryption using the correct key in that isolated
environment. Keep sessions, invitations and queued work disabled during the drill.

The offline verifier restores SQL into a disconnected in-memory SQLite database,
checks integrity/references/counts and verifies media checksums:

```bash
npm run verify:restore -- backups/snapshot.sql backups/inventory.json backups/media
```

Inventory shape:

```json
{
  "source": "record-the-source-database-and-backup-ID",
  "capturedAt": "2026-10-20T00:00:00Z",
  "counts": { "users": 1, "clients": 1, "assets": 1, "posts": 1 },
  "media": [ { "key": "the-object-key", "file": "local-object-file", "sha256": "64-hex-characters" } ]
}
```

Include all table counts and all media keys, not only the four required counts.
The examples are illustrative; fixture success is not production restoration
certification. Record actual elapsed recovery time, missing data, verification
output and the isolated D1/R2 restore identifiers before closing this gate.

## Native acceptance

Link an EAS project, register the intended Android/iOS test devices and install
builds from the exact release commit. `npm run test:mobile` and the native E2E
workflow require Maestro, adb/simulator and a booted device with the e2e build.
The fixture suite is separate from live OAuth/push acceptance.

On both platforms verify OAuth browser return, cold/warm deep links, SecureStore
session persistence and expiration, sign-out, denied photo/notification permissions,
upload, queued revision completion after backgrounding, review/approval, calendar,
notification delivery/tap and reconnect after offline operation. Save device/OS,
EAS build ID, screenshots or trace and operator results. Test real device push;
an emulator-only pass is insufficient. Never use the fixture cleartext networking
configuration for a production build.

## Small supervised pilot

After every applicable gate passes, record an activation decision with the exact
commit, operator, one or two named consenting client workspaces, destinations and
a one-week window. Invite only those users with explicit client assignments.
Start with one accepted provider per client, at most one post per client per day,
no-response policy `hold`, and operator review before each publish. Keep broader
client invitations closed.

The operator checks provider confirmations, destination identity, notification
failures, duplicate prevention and incidents daily. Stop scheduling and pause
unclaimed posts immediately on an ownership leak, duplicate post, uncertain
publication or auth failure. A job already claimed requires provider reconciliation.
Record the pilot's results and an explicit expansion decision; a clean deployment
alone does not authorize broader client access.

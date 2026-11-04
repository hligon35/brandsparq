# BrandSparQ production runbook

Production host: `https://brandsparq.getsparqd.com`

## Cloudflare resources

Create or verify:

- Worker: `brandsparq`
- D1: `brandsparq`
- R2: `brandsparq-media`
- Queue: `brandsparq-publish`
- Queue: `brandsparq-generation`
- DLQ: `brandsparq-publish-dlq`
- DLQ: `brandsparq-generation-dlq`
- Custom domain: `brandsparq.getsparqd.com`

Apply every pending migration before deploying the Worker:

```bash
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
```

## Worker secrets

Required:

```text
AUTH_PEPPER
AUTH_ALLOWED_EMAILS
SOCIAL_TOKEN_KEY

GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_FROM_NAME
REVIEW_NOTIFICATION_EMAIL

OPENAI_API_KEY

META_APP_ID
META_APP_SECRET
META_WEBHOOK_VERIFY_TOKEN

LINKEDIN_CLIENT_ID
LINKEDIN_CLIENT_SECRET

TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET

X_CLIENT_ID
X_CLIENT_SECRET
```

Use a different long random value for `SOCIAL_TOKEN_KEY` than `AUTH_PEPPER`.

### Meta Facebook Login for Business

Set `META_LOGIN_CONFIG_ID` on the Worker to the Configuration ID from
**Facebook Login for Business → Configurations**. This is a server variable;
do not put it in Expo's public environment. It can be stored as a Worker text
variable or secret. The App ID and App Secret must belong to the same Meta app.

When this variable is set, the authorization request sends `config_id` and
requests an authorization code. Permissions come from the Meta configuration,
so the request does not send an overriding `scope` list. Without this variable,
the legacy Facebook Login request continues to use explicit scopes.

The Business Login request also sends `override_default_response_type=true`,
`display=popup`, and `prompt=login`, matching the Meta dashboard's generated
login URL. BrandSparQ generates and persists a fresh security `state` for each
attempt; do not open the dashboard URL containing the literal `<STATE>`
placeholder as a substitute for connecting through the app.

Configure a **User access token** login configuration for the current
Page-discovery flow. Include the permissions needed by enabled features:
`pages_show_list`, `pages_read_engagement`, `instagram_basic`,
`instagram_content_publish`, and `business_management`; include
`pages_manage_posts` when Facebook Page publishing is enabled. The Instagram
professional account must be linked to a Facebook Page accessible to the user.
In development mode, test with an accepted app-role user and permitted assets.

After deploying the updated Worker and setting the variable, start a fresh
connection attempt. No native app rebuild or database migration is needed for
this server-only change. A successful real provider login still needs to be
verified separately from automated tests.

## OAuth callback URLs

Google:

```text
https://brandsparq.getsparqd.com/v1/auth/google/callback
```

Meta:

```text
https://brandsparq.getsparqd.com/v1/social/meta/callback
```

LinkedIn:

```text
https://brandsparq.getsparqd.com/v1/social/linkedin/callback
```

TikTok:

```text
https://brandsparq.getsparqd.com/v1/social/tiktok/callback
```

X:

```text
https://brandsparq.getsparqd.com/v1/social/x/callback
```

The corresponding production URLs are already configured in `wrangler.toml`.

## Social publishing behavior

Connected credentials are encrypted before storage in D1 using AES-GCM and `SOCIAL_TOKEN_KEY`.

Posts must have a connected social account assigned before approval/publishing.

Publishing runs through the Cloudflare queue with idempotency protection and up to three provider attempts. Permanent failures move the post to `failed` and generate an owner notification.

Supported publishing adapters:

- Instagram image publishing through Meta
- Facebook Page photo publishing through Meta
- LinkedIn member image posts
- LinkedIn organization image posts when approved organization scopes are configured
- TikTok photo direct posting with provider-status polling
- X image posts

BrandSparQ now distinguishes provider acceptance from confirmed publication. TikTok posts remain in `provider_processing` until the provider confirms completion.

Connected social accounts are health-checked periodically and can also be verified manually from Social Connections.

Meta webhook endpoint:

```text
https://brandsparq.getsparqd.com/v1/social/webhooks/meta
```

Configure the same `META_WEBHOOK_VERIFY_TOKEN` in Meta and the Worker. POST events are validated with Meta's `x-hub-signature-256` signature before storage.

Optional LinkedIn organization publishing requires app approval for organization scopes. Set only scopes your LinkedIn app has actually been granted, for example:

```text
LINKEDIN_ORGANIZATION_SCOPES=w_organization_social r_organization_social
```

Provider app permissions/review requirements still apply. BrandSparQ cannot bypass provider approval or account eligibility requirements.

## Notifications

BrandSparQ delivers:

- review emails
- pre-publish email alerts
- Expo push alerts to registered native devices
- in-app notification records
- publish-success alerts
- publish-failure alerts

For native push, install dependencies after pulling:

```bash
npx expo install expo-notifications expo-constants
```

Then link the app to an EAS project so `projectId` is available.

## Scheduling

Workspace settings control:

- timezone
- minimum spacing
- maximum daily posts
- preferred windows
- blackout windows
- pre-publish alert timing
- no-response policy
- analytics refresh cadence

Approval passes the AI-proposed time through the scheduling engine. Conflicts are moved to the next valid slot.

No-response policies:

- `auto_publish`
- `hold`
- `skip`

## Analytics

Analytics sync runs automatically according to `analytics_refresh_hours` and can also be started manually from the Analytics screen.

Metrics are stored as snapshots in `post_metrics`, preserving historical measurements rather than overwriting previous results.

## Deployment

From the repository root:

```bash
npm ci
npm ci --prefix cloudflare
npx playwright install --with-deps chromium webkit
cd cloudflare
npx wrangler d1 migrations apply brandsparq --remote
cd ..
npm run deploy:production
npm run smoke:production
```

### Deploy fixes with publishing held

`npm run deploy:production` (also `npm run deploy`) deploys the Worker and web assets
with publishing disabled. It requires a clean checkout, the full `validate` suite,
a dependency audit with no unresolved advisories, all migrations applied, workspace
no-response policy `hold`, pilot mode `hold`, and no unresolved publishing outcomes.
The remote preflight runs before validation and again immediately before upload.
The checkout must still match the validated commit after that final preflight.

This path does **not** require `BRANDSPARQ_RELEASE_EVIDENCE` or hosted CI. It does
not mark any acceptance gate passed. OAuth connections, client setup, uploads and
other application testing remain available. The Worker refuses pilot activation,
new invitations and provider publishing, including queued claims, even if database
pilot settings are changed out of hold. Existing provider outcomes still require
reconciliation; a held deployment cannot undo an already sent provider request.

### Deploy an accepted release, then activate a pilot

After completing the physical-device, provider, restore and other acceptance
requirements in [PHASE_FOUR_RELEASE_ACCEPTANCE.md](PHASE_FOUR_RELEASE_ACCEPTANCE.md),
use the **same clean source commit**:

```powershell
$env:BRANDSPARQ_RELEASE_EVIDENCE = "$PWD\release-evidence\accepted.json"
npm run release:verify
npm run deploy:production:accepted
npm run smoke:production
```

The accepted command additionally verifies the private version 2 report and actual
successful hosted CI for the exact commit, plus the release dependency disposition.
It retains the same validation and production preflights. It still does not activate
publishing: use `pilot:plan` and the owner controls in System Health to configure an
accepted destination, expiry and supervision. The deployed acceptance stamp must
match `RELEASE_COMMIT`; held or unstamped production builds cannot activate pilots.
A later held deployment removes activation eligibility, even for the same commit.

`release:status` describes **live acceptance**, not whether code can be deployed
with publishing held. Its blocked result is expected while operational acceptance
is incomplete. Do not edit an old report merely to replace its commit hash.

Neither command migrates the database, changes hold settings or certifies device
acceptance. Administrative direct Wrangler/D1 access remains outside these guards.

## Production verification

Verify:

1. `/health` responds successfully.
2. Google sign-in completes.
3. Brand Brain saves and reloads.
4. A source image uploads to R2.
5. AI generation creates a campaign and review posts.
6. Review email opens a valid review link.
7. Approval adds the post to Calendar.
8. A social account can be connected and assigned.
9. Test notification delivers.
10. Publish Now creates a provider post and asynchronous providers reach confirmed `published` status.
11. Analytics sync stores a metric snapshot.
12. A failed provider request produces a readable failure notification.
13. Owner can open More → System Health and readiness is healthy.
14. Owner can open More → Access management.
15. A non-owner account can access only explicitly assigned clients.

## Production operations

Sprint 7 adds owner-only System Health and Access Management workspaces.

The one-minute cron recovers stale publishing, generation, and graphic work and cleans expired authentication/review/media tokens. Operational incidents are persisted in D1.

Only owners have implicit access to all clients. Every non-owner role requires an explicit row in `user_client_access`.

The public `/health` endpoint intentionally returns only minimal dependency state. Detailed diagnostics are authenticated and owner-only.


## Client and Brand Brain production data

BrandSparQ now uses live API data only. Client setup includes:
- client name and timezone
- active/archive lifecycle
- expanded Brand Brain fields
- primary and alternate logos
- approved reference images

The canonical schema is the ordered migration set in `cloudflare/migrations/`; the obsolete standalone `schema.sql` file was removed.


## Launch certification

After the latest migrations and deployment, sign in as an owner and open **More → System Health → Run launch check**. A `blocked` result is a release blocker. Review all warnings before launch.

See `docs/SPRINT8.md` for the complete launch-certification and manual acceptance process.

## Workflow safety update

Apply migration `0017_workflow_safety.sql` before publishing the updated Worker and Expo app together. See [workflow safety](WORKFLOW_SAFETY.md) for notification retry behavior, archive safeguards and the manual hold for ambiguous provider outcomes.

## Workspace experience update

Apply migration `0018_workspace_experience.sql` before deploying the Phase 2 Worker and app together. See [workspace experience](WORKSPACE_EXPERIENCE.md) for invitation lifecycle, client role overrides, review delivery and recovery behavior, plus the remaining native and live-provider acceptance steps.

## Cloudflare Workers Builds configuration

Use the repository root (`/`) as the root directory, `npm run build:cloudflare && npx playwright install --with-deps chromium webkit` as the build command and `npm run deploy` as the deploy command. The root deploy alias forwards to the guarded `deploy:production` script, including optional command arguments. The production script resolves `cloudflare/wrangler.toml` explicitly and builds the assets with the production API origin.

A successful Expo export only creates `dist`; it does not deploy the Worker. A failed deploy leaves the previous Worker version serving the custom domain, even if its variables have been edited. Inspect the deployment result, not just the build result.

Cloudflare Git Builds can use the default **held** deployment without a private
acceptance report. Provision Cloudflare credentials and install both root and
`cloudflare` dependencies, plus the Chromium/WebKit browsers and system libraries
required by `validate`, in the build environment. The deploy command runs validation
and the production database preflight; a successful web export alone is insufficient.
Set the build command to install prerequisites as needed for your runner, for example
`npm run build:cloudflare && npx playwright install --with-deps chromium webkit`.
The deploy script itself builds production assets during validation.

The Worker install checks peer dependencies explicitly. Wrangler 4.151.3 requires
Workers types v5. Its Undici security override is declared at package scope so
clean installs resolve the same patched version under npm 10 and npm 11. Do not
work around a lockfile failure with `--force` or by installing an unpatched Undici.

Keep the Git Build deploy command `npm run deploy`. Perform accepted deployments
through the separate operator command above with privately provisioned evidence;
never put the report or owner credentials into the public repository. Each later
Git Build returns the application to a held deployment, so pause automatic builds
while an accepted supervised pilot is active. The live preflight also rejects a
build while the database pilot mode is supervised.

The production-readiness migration `0017_production_readiness.sql` and workflow-safety migration `0017_workflow_safety.sql` both precede Phase 2 migration 0018. Apply all pending migrations in filename order.

## Smoke checks behind Cloudflare Access

An Access sign-in redirect means the smoke request has not reached the Worker. A successful deployment does not prove application readiness, and an Access HTML response cannot certify the application's session guard.

For automated checks, create a dedicated service token in Cloudflare Zero Trust and authorize that token in the BrandSparQ Access application's **Service Auth** policy. Keep the existing human Google sign-in policy. Use the client ID and secret from that token (not the Google OAuth credentials):

```powershell
git pull origin main
$env:CF_ACCESS_CLIENT_ID = Read-Host "Access service token client ID"
$credential = Get-Credential -UserName "access-service-token" -Message "Enter the Access client secret as the password"
$env:CF_ACCESS_CLIENT_SECRET = $credential.GetNetworkCredential().Password
npm run smoke:production
Remove-Item Env:CF_ACCESS_CLIENT_ID, Env:CF_ACCESS_CLIENT_SECRET
Remove-Variable credential
```

No redeploy is needed for this script-only change. Never commit the credentials. The smoke script does not follow redirects or send an app session, so service credentials remain on the configured origin and `/v1/dashboard` must still reject anonymous application access with a JSON 401. Missing/denied Access credentials remain a failing check, with an explicit gate diagnostic.

Reference: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/

## Pilot-readiness hardening

Apply `0019_revision_jobs.sql` and `0020_supervised_pilot.sql` before deploying this release. Follow
[PILOT_READINESS.md](PILOT_READINESS.md) for isolated staging, Access routing,
provider acceptance, restoration and native evidence, and supervised pilot gates.
AI revisions now return a durable queued job rather than waiting for AI inside the
request; review screens poll while the post is regenerating. A stale in-flight
publisher is held for provider reconciliation rather than automatically reposted.


### Preflight diagnostics on Windows

`npm run preflight:production` invokes the installed Wrangler JavaScript entry
through Node, with the repository root as its working directory. Migration names,
publishing holds and unfinished publishing are read using three separate
single-line `--command` queries. This avoids multiline shell/shim argument issues.
Each query must return its own successful D1 SELECT rows; SQL-file import
statistics are not accepted as deployment evidence.

If Wrangler fails, the error names the check and includes the original CLI output
or process/timeout error. Do not infer missing migrations or bad authentication
from a generic failure. When holds are absent, preflight shows the actual pilot
mode and workspace no-response policy. All existing migration, hold and
unfinished-publishing requirements remain enforced; these reads change no data.

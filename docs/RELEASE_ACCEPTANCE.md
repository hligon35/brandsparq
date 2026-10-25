# Release acceptance: October 25, 2026

Branch: `fix/release-acceptance`. Initial base: `a34bd30`; integrated main through `233ab73` (campaign objective scrolling).
Selected pilot scope: **internal test workspace only**, as selected by the owner.
No external client invitations or public social posts were sent. No production
migration, deployment, Access policy change, or pilot activation was performed.

## Implemented defects and exact reproductions

`tests/release-interleavings.test.mjs` reproduces the four original defects using
SQLite transactions and deferred provider responses. The cases failed on main
before the fixes; they pass with this change.

1. Start AI, expire/recover its job, save a newer manual edit, then release the old
   provider response. Old caption/image writes, variants and scores cannot replace
   the newer result. Every revision write checks active job ownership and state.
2. Read a reschedule candidate, let an old publisher claim and enter the provider,
   then attempt the reschedule before the provider completes. Reschedule returns
   409 without canceling/rewriting the claimed execution; old provider completion
   remains authoritative. Bulk shift uses the same guarded reservation.
3. Let two approvals select against the same calendar before either writes.
   A client calendar epoch forces the losing selection to retry. Slots respect
   spacing and daily limits. Single, bulk and public-token approvals share the
   transaction, including approval records and review-token consumption.
4. On an empty staging database with empty admission, complete valid Google
   identity verification. No user/owner or handoff is created. Production, unknown
   environments and missing environment also fail closed. Explicit development
   retains local development admission. Concurrent allowlisted bootstraps create
   exactly one owner.

Apply **0023_schedule_reservations.sql** before deploying this Worker. Do not edit
already applied migrations. Run `npm run schema:check` after any migration change.

## Local verification

The complete `npm run validate` quality gate passes: **113 backend tests and all
66 browser scenarios**, across desktop Chromium, mobile Chromium and mobile
WebKit, plus TypeScript, lint, formatting, Expo compatibility, schema manifest and
web export. Final Android and iOS JavaScript exports and the Worker packaging dry run pass. Local system browser libraries
were supplied for the test runner; no browser or test assertions were skipped.
The browser archive selector was updated to the current accessible client link.
The executable source fingerprint and counts are recorded in
`docs/evidence/2026-10-25-local-validation.json`. This is local validation, not a
GitHub CI success or live provider/device acceptance.

## Live evidence collected here

These results describe the **currently deployed production version**, not the new
branch, so they cannot certify the branch for activation.

- Anonymous private/public media/review/invitation guards, invalid Google callback,
  four social callback state guards and invalid Meta verification token: **10 pass**.
- Unsigned Meta POST: **405 rather than required 401**. Current handler produces
  this result when `META_APP_SECRET` is absent. Provision the correct app secret;
  do not weaken signature validation.
- Production smoke: login SPA, Google OAuth start and private API guard pass;
  **public health returns 503**. An authenticated owner must inspect System Health
  for the missing configuration/binding. Public health deliberately hides details.
- GitHub Actions [run 40230879669](https://github.com/hligon35/brandsparq/actions/runs/40230879669) failed before any steps. Its annotation is: “The job was not started because your account is locked due to a billing issue.” No code change can resolve that account restriction. GitGuardian's secret scan passed. The configured Workers Builds check also failed; its dashboard logs are not available through this connection.
- Branch-protection inspection returned **403 Resource not accessible by integration**. Required-review/status policy is unverified; it has not been altered.
- Wrangler reports **not authenticated** and EAS reports **Not logged in**. No account resources were changed. No Cloudflare/Expo integration was found in the available plugin search.
- Maestro, adb and iOS device/simulator tools are absent. Native JavaScript exports
  can run here; signed builds, physical OAuth return and push cannot be certified.
- An actual production backup and R2 archive are not available here. Fixture
  restoration tests are not an actual production restoration drill.

The anonymous probe report is in `docs/evidence/2026-10-25-production-routing.json`.
Run fresh probes after deployment and record the exact deployed commit/version.

## Isolated staging

Provision the resources in [PILOT_READINESS.md](PILOT_READINESS.md), then create the
ignored `.env.sandbox` (never use production identifiers or credentials):

```dotenv
BRANDSPARQ_STAGING_ORIGIN=https://brandsparq-staging.ACCOUNT.workers.dev
BRANDSPARQ_STAGING_DATABASE_ID=NEW-STAGING-D1-UUID
BRANDSPARQ_STAGING_GOOGLE_CLIENT_ID=SEPARATE-CLIENT.apps.googleusercontent.com
BRANDSPARQ_STAGING_ALLOWED_EMAILS=YOUR-EXPLICIT-OPERATOR-EMAIL
```

```powershell
npm run configure:staging
npm run migrate:staging
npm run deploy:staging
```

Configuration refuses empty operator admission and production resources. It sets
staging-only CORS and uses staging's Google client. Separate secrets must be
provisioned to that Worker, including social provider **test app** secrets.
Staging initialization creates `BrandSparQ Internal Acceptance`, holds publishing,
and sets workspace, client and notification no-response policies to `hold`.
It seeds no social credentials, destination, user, session or client invitation.
Reapplying initialization restores the hold.

## Native acceptance

The new `staging` EAS profile has a separate app ID and `brandsparq-staging` scheme.
Set the **preview EAS environment's** `EXPO_PUBLIC_API_URL` to the verified isolated
staging HTTPS origin, then:

```powershell
npm run build:staging:android
npm run build:staging:ios
```

Staging configuration rejects a missing/production/loopback API URL. These are
internally distributed builds, not TestFlight uploads. Record the exact source
commit and EAS build IDs; install on physical Android and iOS devices. Preview
and production profiles retain their existing target; only staging uses the
separate app ID. Never send staging OTA updates to preview/production channels.

On each platform record OAuth browser return (cold/warm), deep links, SecureStore
persistence/expiry/sign-out, denied image/push permissions, PNG/JPEG/HEIC upload,
background AI completion, review/approval, calendar, offline reconnect and actual
push receipt/tap navigation. Emulator fixtures supplement this evidence.
`BRANDSPARQ_E2E_BUILD=1` is rejected in non-e2e EAS build profiles.

## Provider acceptance and restoration

Only the named internal test workspace/destination belongs in the first pilot.
Connect a designated test destination, verify its identity, generate/revise/approve
content, and record the actual provider post ID/URL plus final confirmation.
Test duplicate delivery, rejection, uncertainty/reconciliation, disconnect/reconnect,
review email, analytics and webhook signature/replay behavior. A callback guard
probe is not a successful OAuth round trip or successful provider publication.
See the full checklist in [PILOT_READINESS.md](PILOT_READINESS.md).

For the actual drill, privately export production D1, a contemporaneous complete
row-count inventory and all referenced R2 bytes with SHA-256 checksums. Restore to
an otherwise empty **separate** D1 database and R2 bucket with no deployed Worker,
cron, consumers, live sessions or provider jobs. Validate remote counts, foreign
keys, all source/derivative/generated media and token decryption with the retained
key. Do not connect a restore Worker to live providers. Record backup ID, isolated
resource IDs, elapsed recovery time, missing/corrupt objects and decryption result.
The offline verifier is an additional check:

```powershell
npm run verify:restore -- backups/snapshot.sql backups/inventory.json backups/media
```

## Production safeguards

Root deployment aliases and the Cloudflare package's `deploy` command now enter
the same guarded release script. It requires:

- a clean checkout and evidence for the exact commit, recorded within seven days;
- all eight actual acceptance results, operator identity and stable private URLs;
- physical Android/iOS device/build details, accepted provider scope and an owner's
  dependency decision;
- actual isolated D1/R2 restoration details, checksum and decryption confirmation;
- the full local quality gate plus a fresh dependency disposition check;
- a live D1 preflight showing all local migrations applied, pilot mode `hold`,
  workspace no-response `hold`, and zero in-flight publishing jobs.

Copy `docs/release-evidence.example.json` into ignored `release-evidence/`, fill it
with real results and set `BRANDSPARQ_RELEASE_EVIDENCE` to that file's path.
These are explicit operator attestations: the script validates their completeness
and commit binding, **not** the truth of linked evidence. It does not invent CI,
provider, restore or device acceptance. Direct administrative Wrangler use and
account/branch-protection policies are outside this repository guard.

```powershell
$env:BRANDSPARQ_RELEASE_EVIDENCE = "$PWD\release-evidence\accepted.json"
npm run preflight:production
npm run deploy:production -- --dry-run
npm run deploy:production
npm run smoke:production
```

Hold publishing in **System Health → Supervised pilot** and choose `hold` in
Settings before the deployment preflight. Reconcile claimed/uncertain outcomes
first. The script checks the existing hold and never changes live policy itself.
It forces production API configuration while building production assets. Apply
migrations separately after backup; deployment does not silently migrate data.

## Activation decision

**Blocked**, pending actual acceptance and authenticated infrastructure access.
No real clients are in scope. After all gates pass, activate only the internal
workspace and its one accepted provider destination, for at most seven days.
Use explicit owner review for every publish and at most one execution/day (UTC).
Activation transactionally saves workspace/client no-response hold policies.
Expiration and uncertainty remain held; review provider outcomes daily and record
incidents and the explicit decision before expansion. Existing pilot controls and
records enforce this scope; a passing local test is not activation evidence.

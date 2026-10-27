# Phase 4 — release acceptance and supervised pilot

## Current status: implementation complete; live acceptance blocked

The code follow-up and manual testing handoff are recorded in
[PHASE_FOUR_CODE_GAPS.md](PHASE_FOUR_CODE_GAPS.md). The original verification
results below are retained as the initial Phase 4 record.

This branch is based on main after the Phase 3 merge (PR #19).
No staging/production migration, deployment, OTA publication, real social post,
external invitation or pilot activation was performed here.

### Implemented

- Version 2 release evidence requires all fifteen physical-device scenarios on
  **each** platform and ten provider scenarios for **each accepted** provider.
  Required fields include staging build/profile/channel/runtime/API identity,
  actual provider receipt/destination identity, the current app runtime, fresh evidence and restoration
  artifact hashes. Missing/stale/fixture evidence fails admission.
- `release:verify` validates evidence and reads the actual GitHub Actions run.
  Repository, quality workflow identity, run ID, exact source SHA, completed status
  and success must match.
  Production deployment runs this check before its existing quality gates,
  dependency disposition and live D1 preflight.
- Guarded deployments stamp `RELEASE_COMMIT`. Staging also requires a clean
  checkout. Pilot activation and queued pilot claims must match that deployed
  commit. Pending provider confirmations and unknown outcomes block activation
  atomically. Holding remains available while an outcome is unresolved.
- `pilot:plan` reads current owner controls and prepares one accepted destination
  only after full evidence/hosted CI verification. It requires the matching held
  deployment, current revision, no in-flight work and expiry within seven days.
  It prints a reviewable payload; it never activates or publishes.
- Native fixture acceptance uses `com.alphazonelabs.brandsparq.e2e` and
  `brandsparq-e2e`, the loopback API only, and disabled OTA. It cannot clear an
  installed production/staging app. The Maestro flow follows current Home,
  Review, Clients and Profile/sign-out routes. **A new e2e native build is required.**
  Production and staging native identities are unchanged.
- Expo SDK 58 compatibility patches are applied (Expo 58.0.20, Router 58.0.27,
  dev client 58.0.16 and web browser 58.0.7). App version is **0.1.1** with
  the `appVersion` runtime policy. **Fresh native builds are required** for
  production, staging and e2e; do not deliver this runtime to old 0.1.0 binaries.
- The disconnected restore verifier rejects external database operations and
  media symlink escapes, returns the SQL hash and can verify both access and
  refresh-token decryption without printing tokens. Its receipt explicitly says
  `remoteRestoreVerified: false`; it cannot certify a remote restoration.
- Time pickers render all 24 hours and 60 minutes in bounded scroll views. The
  virtualized minute list could leave a requested option unrendered. Browser
  regression coverage selects both 10:30 and the final 23:59 option.
- Playwright updated from 1.56.1 to 1.64.1. The old bundled WebKit aborted during reschedule/history navigation; the identical scenario passes on the current engine with its existing assertions retained.
- Forge updated compatibly from 1.4.0 to 1.4.2, with lockfile and signing regression
  coverage. The old Forge waiver was removed. Root audit now reports **three high
  affected package entries for one remaining Zod advisory**; Worker audit is clean.
  Expo CLI still declares Zod 3.25.76. No major Zod substitution was made. See
  [DEPENDENCY_ADVISORIES.md](DEPENDENCY_ADVISORIES.md).

## Checks available in this environment

- Backend regression suite: 205 tests passed, including thirteen Phase 4 cases.
- Full migrated fixture snapshot reconstructs all application tables and original,
  analysis, generated graphic and variant bytes, with retained-key decryption.
  This is a **fixture rehearsal**, not the actual D1/R2 restoration drill.
- Root/Worker TypeScript, schema, lint, formatting, launch checks, Expo compatibility, web and Android/iOS JavaScript exports, and Worker packaging dry run passed. Browser results are recorded below.
- Initial desktop/phone Chromium run: 99/102 passed. Two failures exposed the
  virtualized minute-list defect; the other was a navigation timeout in the viewer
  scenario. That viewer scenario passed four focused repeats. After the picker
  fix and a fresh web export, the expanded time-selection test passed twice on
  each of desktop Chromium, phone Chromium and phone WebKit (six passes), including
  10:30 and the final 23:59 option. Assertions and test deadlines were retained.
- Full phone WebKit run: 49/51 passed. Narrow-screen navigation exceeded its
  session-restoration assertion deadline once; the social creation case exceeded
  the setup-hook deadline once. Both exact scenarios then passed twice each
  (four passes) with unchanged assertions/deadlines. The full local browser runs
  were not uniformly green; these intermittent timing failures remain recorded.
  The final time-picker fix passed all six focused browser checks and the full
  WebKit time-picker case. Hosted CI and actual-device acceptance remain required.
- Browser libraries were supplied in an isolated local cache. The host dependency-cache probe was bypassed for that local runner; application/browser assertions were executed. CI retains its normal `playwright install --with-deps` setup.
- Anonymous probes earlier in this session against the **then-deployed production version**:
  10/11 passed; unsigned Meta POST returned 405 instead of required 401.
  These probes do not certify this branch. The branch already includes the
  configuration/signature fixes from earlier work; deployment and Meta secret
  provisioning remain unverified.

## Verified external blockers

- Wrangler: not authenticated. No Cloudflare token or staging resource variables
  are present. No matching Cloudflare integration was found.
- Expo: `expo whoami` reports not logged in. No Expo token, EAS command or matching
  integration is available.
- Maestro, adb and iOS device/simulator tools are absent. JavaScript exports and
  browser phone emulation cannot establish physical-device acceptance.
- No actual production D1 snapshot, complete R2 archive or retained decryption key
  has been supplied. No actual restoration result can be recorded.
- GitHub branch-protection inspection returns 403 `Resource not accessible by integration`. Cloudflare dashboard build/deployment policy is also unverified without account access.
- The preceding PR's hosted workflow was blocked by GitHub's account billing lock.
  Phase 4 was pushed as PR #22. Its initial hosted validation job also did not start because of the billing lock; the Cloudflare build check failed without exposing diagnostic logs through GitHub.
- Zod requires a compatible upstream fix or the owner's explicit current risk
  disposition. A passing baseline audit is not security clearance.

## Execution order when access is available

### 1. Integrate and confirm CI

Verify that automatic production builds are held or use the guarded release command before merging anything that can trigger deployment. Phases 1–3 are merged into main; integrate this branch on the review/integration branch. Rerun CI on the exact final release
commit; a previous PR head or merge-test SHA does not certify a different commit.
Resolve the GitHub billing lock before expecting Actions to execute. Do not edit
workflow assertions or evidence to turn a blocked run into a pass.

### 2. Isolated staging

Use `docs/RELEASE_ACCEPTANCE.md` and `docs/PILOT_READINESS.md` to provision separate
D1, R2, queues and provider test applications. Set explicit staging operator
admission and OAuth client. Authenticate Wrangler in the operator terminal.

```powershell
npm run configure:staging
npm run migrate:staging
npm run deploy:staging
$env:BRANDSPARQ_BASE_URL = "https://brandsparq-staging.ACCOUNT.workers.dev"
npm run smoke:staging
npm run smoke:routing
```

Migration order includes 0024, 0025 and **0026_personal_preferences.sql**. Phase 4
adds no migration. Staging initialization retains publishing/no-response holds.
Verify authenticated System Health and empty-admission rejection before testing.
Fix Access routing in the Cloudflare account so callbacks, signed review/media
links and webhook delivery reach application guards; do not bypass signatures.

### 3. Physical Android and iOS

Build the `staging` EAS profile against the isolated HTTPS API. Use actual devices,
not the separate `e2e` fixture profile, for release evidence. For each platform
record build ID, OS, device, channel, runtime and every `checks` entry in
`docs/release-evidence.example.json`: cold start, cold/warm OAuth return, deep links,
SecureStore restore/expiry/sign-out, denied photo access, PNG/JPEG/HEIC upload,
background generation, review/calendar, offline reconnect, actual push receipt/tap,
and matching/rejected-runtime OTA behavior.

For supplementary emulator fixtures:

```powershell
npx eas-cli@latest build --platform android --profile e2e
npx eas-cli@latest build --platform ios --profile e2e
# Install the isolated build and boot the selected device first.
$env:BRANDSPARQ_MOBILE_PLATFORM = "android" # or ios
npm run test:mobile
```

### 4. Providers and actual restoration

For the designated internal workspace, record the exact connected account ID,
provider post ID/URL, OAuth round trip and final publish confirmation. Complete
all provider checks in the evidence template. Only non-Meta webhook checks can be
not applicable, with a recorded reason. Use controlled staging fault injection for
rate limits and uncertain outcomes; never hammer live services to provoke errors.
Distinguish actual provider observations from injected transport failures in each
summary/reference. Do not mark an unsupported analytics integration as passed.

Export production D1 and complete R2 bytes privately. Record contemporaneous table
counts and every referenced original/derivative/generated object checksum.
Restore to an empty separate D1 and R2 bucket with no Worker, cron, queue consumer
or provider connectivity. Revoke restored sessions, verify remote counts/foreign
keys/media and test retained-key decryption. Record the actual isolated resource
IDs, source SQL/inventory SHA-256, elapsed time and zero missing/corrupt objects.
The local verifier supplements those remote observations:

```powershell
# Keep the retained SOCIAL_TOKEN_KEY in this private environment variable.
npm run verify:restore -- backups/snapshot.sql backups/inventory.json backups/media --verify-tokens
```

Never commit backup data, credentials or completed private evidence.

### 5. Prepare production and the pilot

Copy the version 2 template to ignored `release-evidence/accepted.json`; complete
it with actual current results and the owner's dependency decision. Gate evidence
must be for the exact release commit and within seven days. One private report URL
can support multiple checks if its summary identifies the relevant observations.

```powershell
$env:BRANDSPARQ_RELEASE_EVIDENCE = "$PWD\release-evidence\accepted.json"
npm run release:status
npm run release:verify
npm run preflight:production
npm run deploy:production -- --dry-run
npm run deploy:production
npm run smoke:production
```

Keep workspace/client no-response policies and publishing in `hold`. Only after
all gates pass, set `BRANDSPARQ_PILOT_ORIGIN`, private `BRANDSPARQ_OWNER_TOKEN`,
`BRANDSPARQ_PILOT_CLIENT_ID`, `BRANDSPARQ_PILOT_DESTINATION_ID` and ISO UTC
`BRANDSPARQ_PILOT_ENDS_AT`, then run `npm run pilot:plan`. Inspect its payload before
saving the same accepted scope through System Health → Supervised pilot.

Initial scope is the internal test workspace and one accepted destination. No
external invitations or expansion are authorized by a fixture result. Every
publish requires owner review, one execution/client/UTC day maximum, seven-day
maximum expiry. Stop with `hold` on uncertainty, wrong destination, token incident,
failed restoration/receipt checks or missing owner supervision. Record daily
provider outcomes and the expansion/stop decision.

The evidence format validates completeness; apart from the live CI query, it
cannot establish the truth of private linked observations. Administrative direct
Wrangler access and account policy remain outside the repository guard.

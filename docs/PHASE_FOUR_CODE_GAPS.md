# Phase 4 code follow-up and acceptance handoff

## Implemented

- All API JSON requests and image uploads have deadlines covering both headers
  and body reads. Caller cancellation is retained. Only reads may retry once;
  mutations never replay automatically and durable creation IDs remain in force.
- Session restoration has an eight-second request deadline and ten-second startup
  recovery boundary. Offline/5xx/unreadable responses retain the saved credential
  and show Retry connection / Sign out. A confirmed current-session 401 clears it.
- Old-session 401 responses, public-link failures and failed OAuth handoffs cannot
  sign out a newer account. Handoff completion and restore callbacks are fenced
  at every asynchronous boundary. Failed handoff promises are not cached forever.
- Local sign-out clears the UI/credential without waiting for remote revocation.
  Background cleanup retains the departing account's authorization and unregisters
  its push token before revoking that session. Permission dialogs and queued native
  registration are bound to the initiating session. Session and
  push-device storage operations are serialized so older deletion cannot erase a
  newer write. Registration, storage and unregistration share the device queue.
  Remote logout/unregistration still require connectivity; local
  sign-out alone does not prove server-side revocation.
- Web routes are registered synchronously. The prior asynchronous web chunks
  produced delayed/blank protected screens during direct route loads; the viewport
  regression now requires the actual requested Home/Review/Create/Calendar/More
  heading rather than any heading. Native route import behavior is unchanged.
- The authenticated Review queue now lives in the root stack at `/review`.
  Direct loads previously rendered Home through the hidden tab route. Public
  `/review/[token]` links retain their separate access behavior.
- Browser fixtures load one immutable exported asset set, reject missing static
  assets correctly, use content-hash ETags with browser revalidation like Workers
  Static Assets, and serialize backend requests with fixture resets. A reset
  cannot close a database while an earlier request is using it. Migration SQL is
  read once per process, but every fixture applies all migrations to a fresh DB.
- The Cloudflare compilation entry point resolves its repository root, installs
  the Worker lockfile, forces the production API (or validates the isolated
  staging origin), clears fixture networking and rejects mismatched Cloudflare
  commit metadata. Compilation does not deploy, migrate or activate publishing.
- Production and staging deployment commands recheck source SHA and checkout
  cleanliness immediately before invoking deployment, after validation finishes.
- Audit checks reject inconsistent totals, missing/cyclic advisory chains and
  findings without a reviewed leaf. Release evidence also requires the explicit
  approver, exact package/version, decision, mitigations, recorded time and next
  review for each unresolved advisory. Next review must be future, within seven
  days and no later than the reviewed advisory's expiry. No owner approval was
  fabricated; the example report remains blocked/pending.

## Dependency compatibility outcome

Zod 3.25.76 is still required by Expo CLI 58.1.16. Zod 4.6.6 was evaluated and
the experimental override was reverted: `@expo/mcp-tunnel` 0.2.3 wraps CLI schemas
in Zod 3 and serializes them with `zod-to-json-schema`. Replacing the CLI's schema
objects with Zod 4 would break that optional integration. The upstream patch
changes v4 collections, so using v3 exports from a v4 package is not demonstrated
remediation either. There is no compatible published Zod 3 patch in the registry
at this review. Root audit remains three high affected entries for one tracked
advisory; Worker audit is clean. This needs an upstream compatible release or an
actual owner disposition, not a fabricated clean audit.

References: [advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[upstream patch](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd).

## Verification

- 217 backend/regression tests passed, including twelve new code-gap cases and the
  staging integration case that changes source during validation.
- Root and Worker TypeScript, schema, lint, formatting, launch audit and Expo
  compatibility passed. Dependency audit matches the tracked baseline above.
- The actual Cloudflare compilation command, production Worker packaging dry run,
  final web export and Android/iOS JavaScript exports passed.
- The final targeted browser run passed all 12 cases across desktop Chromium,
  mobile Chromium and mobile WebKit: both narrow viewport route matrices,
  expired-session recovery and campaign back navigation. The full browser suite
  has not been rerun after the final route changes; its earlier run had 158/162
  passing before those fixes. No physical-device or live-provider result can be
  inferred from a browser fixture.

## Before physical testing

1. Use the committed source and install both lockfiles with `npm ci` and
   `npm ci --prefix cloudflare`. The app/runtime remains **0.1.1**. This follow-up
   adds no native package/ABI change and no migration; its route-import setting is
   web-only. A 0.1.0 binary
   still requires the Phase 4 native rebuild.
2. Provision the isolated staging resources and apply migrations through 0026.
   Configure its separate OAuth client, explicit admission, provider secrets and
   callback/webhook routes. Keep workspace/client no-response policies on hold.
3. Supply the isolated HTTPS API as `EXPO_PUBLIC_API_URL` in the staging EAS build
   environment. Build with `npm run build:staging:android` and
   `npm run build:staging:ios`. Use actual devices with the staging profile/channel,
   not the separate loopback e2e fixture builds.
4. Copy `docs/release-evidence.example.json` into ignored `release-evidence/`.
   Record the exact committed SHA, build IDs, device/OS, runtime, API origin and
   evidence for each check. Do not mark a gate passed until actually observed.

## Physical and live checks to record

| Area | Acceptance |
| --- | --- |
| Both devices | Cold start; cold/warm Google return; deep links; saved-session restore/expiry; sign out; denied photo access; PNG/JPEG/HEIC uploads; background generation; review/calendar; offline reconnect; actual push receipt/tap; compatible/rejected-runtime OTA. |
| New session recovery | Start offline with a saved login; verify a recovery screen and retained login; reconnect and retry. Sign out during a network outage; verify the login screen and no restored local session after relaunch. Reconnect and verify remote revocation/unregistration separately. |
| Every launch provider | Actual OAuth/account identity, approved publish receipt, duplicate handling, rate limit, revocation, delayed receipt, uncertain-outcome reconciliation, reconnect, analytics and signed/replayed webhook handling where applicable. |
| Restoration | Actual production D1 snapshot and complete R2 archive restored to disconnected resources; verify counts, foreign keys, media hashes, revoked restored sessions and retained-key token decryption. |
| Production policy | Branch protection, production/preview build configuration, source identity, migrations, publishing holds and no unresolved publication outcomes. |
| Pilot | Only after all gates pass: owner supervision, one accepted destination, one execution/client/UTC day, expiry within seven days and recorded daily outcomes. |

## Account setup still required

- GitHub's billing lock prevented the previous hosted validation job from starting.
  It cannot be fixed in application code. Rerun CI on the exact release commit
  after account access is restored.
- The previous Cloudflare build check exposed no diagnostic log through GitHub.
  Inspect its dashboard log before assigning a cause. Use these command pairs:

  | Dashboard root | Build command | Guarded production deploy command |
  | --- | --- | --- |
  | Repository root | `npm run build:cloudflare` | `npm run deploy:production` |
  | `cloudflare` | `npm run build` | `npm run deploy` |

  Deployment still requires private completed evidence and live preflight. A
  successful compilation does not authorize deployment. Disable production-resource
  preview uploads and configure a separate staging Worker for staging tests.
  Verify these account settings before merging anything that triggers production
  deployment.
- If the root advisory remains, the owner must provide a real disposition in the
  private report; a compatible upstream dependency fix is preferable.

Run `npm run release:status`, `npm run release:verify` and
`npm run preflight:production` after recording acceptance. These commands must
remain blocked while evidence or account prerequisites are missing. See
[PHASE_FOUR_RELEASE_ACCEPTANCE.md](PHASE_FOUR_RELEASE_ACCEPTANCE.md) for the full
execution order. No deployment, remote migration, OTA or pilot activation was
performed during this code follow-up.

# Gap closure — Phase 4: release-candidate verification

## Code and automation

- The existing branch `feat/gap-closure-phase-three` includes Phases 1–4. No release merge, production migration/deployment, native build submission, OTA publication or pilot activation is part of this code update.
- Exact-version source backports remediate both known Expo toolchain advisories without replacing Zod 3 with an incompatible major version. Installation and validation verify original/patched SHA-256 values. Unknown versions, altered installed sources, affected nested copies and new advisories fail closed. See [the backport provenance and contract](../patches/toolchain/README.md). Raw npm audit still reports eight upstream package entries (three high, five low) deriving from those two advisories; these counts are preserved in output alongside verified local remediation. Worker audit remains zero. No owner risk waiver was fabricated or added.
- `npm run validate:candidate` requires a clean committed checkout and runs the full quality gate, iOS and Android JavaScript exports and a Worker packaging dry run. It writes `test-results/release-candidate.json` with exact commit/tree, timestamps and step outcomes, and verifies that the checkout did not change. The receipt explicitly records `operationalAcceptance: false`.
- Hosted CI now runs for feature-branch pushes, uses the same candidate command and uploads its receipt, browser results and traces. The job budget is 30 minutes. A failed or missing hosted run cannot satisfy the existing production release gate.
- Browser coverage adds recovery beyond 100 paused posts, generation jobs leaving the selected filter, and durable analytics progress surviving reload and advancing after queue delivery. Existing stale-brand/post editors, logo persistence, workflows, permissions, session recovery and all prior scenarios remain included.
- Browser verification found two identical client-workspace headings. The redundant client navigation title is hidden while the page heading and header actions remain. A malformed legacy image fixture and a published-post fixture missing its publication timestamp were corrected to represent valid persisted inputs; assertions and production guards were retained.

## Reproduce

```sh
npm ci
npm ci --prefix cloudflare
npx playwright install --with-deps chromium webkit
npm run validate:candidate
```

There are 277 Node tests and 180 browser cases across desktop Chromium, mobile Chromium and mobile WebKit. Discovery is not an execution result. Check the command exit status and generated receipt for the exact commit being accepted.

### Browser tests after pulling updates (including Windows)

Run `npm run test:e2e`. Playwright builds a fresh web export into `.expo/e2e-web` before starting the fixture server. It overrides the API origin for same-origin fixture requests and disables dotenv loading for that export. Your normal `dist` deployment export is preserved. Both npm and direct Playwright invocations use this launcher; no separate manual web rebuild is needed.

The fixture verifies a source fingerprint before serving the export. Failed builds or sources changing during compilation stop startup with a specific error. The 180-second web-server startup budget includes compilation; individual test deadlines and assertions are unchanged. Old `dist` files can no longer mix with newer backend code or newer test expectations.

If a test still fails, retain its first full assertion error and the corresponding `test-results/**/error-context.md` or Playwright trace. A summary of test names alone cannot establish the cause of a Windows-specific failure.

The local runner's default browser CDN returned HTML instead of ZIP archives. Exact configured Chromium 156.0.8078.4 / revision 1248 and WebKit 27.2 / revision 2370 were obtained from their official Google and Microsoft download origins. Ubuntu system libraries were downloaded/extracted for this runner. No browser version substitution, test skip or host-validation bypass was used. Hosted CI uses Playwright's normal installer.

JavaScript exports are not signed Android/iOS builds and do not establish device acceptance. The full candidate receipt remains separate from operational release evidence.

## Operational acceptance: still blocked

This environment has no Cloudflare API/account credentials, isolated staging resource configuration, Expo token, physical-device/ADB/Maestro/Xcode toolchain, restoration key or completed private release-evidence report. Consequently the following cannot be truthfully marked passed here:

| Gate | Required next evidence |
| --- | --- |
| Hosted CI | A successful `.github/workflows/ci.yml` run for the pushed commit, including candidate receipt and browser artifacts. Inspect actual job logs/annotations if the account prevents startup. |
| Isolated staging | Separate D1/R2/queues and OAuth callbacks; explicit operator admission; publishing/no-response holds. Configure, migrate and deploy using the existing staging scripts. |
| Provider acceptance | Each launch provider's actual OAuth identity/permissions, exact approved outbound copy, receipt/reconciliation, revocation/reconnect, throttling and supported analytics; signed webhook checks where applicable. |
| Android and iOS | Physical staging builds with real Google returns, permissions and PNG/JPEG/HEIC conversion, reconnect/background behavior, push receipt/tap and compatible/incompatible-runtime OTA. |
| Restoration | An actual isolated D1/R2 restoration from a real backup, measured duration, full media inventory/checksums, credential decryption and session revocation. The local restore unit tests are not this drill. |
| Supervised pilot | Explicit owner-approved scope, holds, destinations, daily limits, expiry and supervision evidence, after every prerequisite passes. |

Use [the acceptance runbook](PHASE_FOUR_RELEASE_ACCEPTANCE.md) and `docs/release-evidence.example.json`. The advisory disposition array is empty for this verified patched toolchain; the owner acceptance and all other real-evidence requirements remain intact. If an unpatched advisory appears, record its exact scoped disposition only with the owner's actual decision.

## Rollout

This phase adds no database migration or native module. Apply **0027_gap_closure_integrity.sql** and **0028_recovery_jobs.sql** in order before deploying the matching Worker and client JavaScript. Existing source-defined publishing holds and release verification remain enforced. Do not activate the pilot based only on tests or a commit being pushed.

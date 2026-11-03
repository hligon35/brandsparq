# Expo patch installation and deployment validation

## Root cause

Expo's compatibility check could prompt to fix dependencies during `validate`. Accepting that prompt mutated the checkout partway through guarded deployment. The SDK 58 patch update also removed transitive deepmerge/Zod installations, while the repository's backport verifier and behavioral tests require their exact reviewed root versions.

## Fix

- Declare deepmerge 4.3.1 and Zod 3.25.76 as exact development dependencies; normal `npm ci` still applies and verifies their existing hash-checked security backports. Do not omit development dependencies on build machines.
- Update Expo to 58.0.22, dev-client 58.0.18, router 58.0.29, updates 58.0.20 and screens 4.30.1, with a committed lockfile.
- `npm run check:expo` runs Expo's check under CI mode and propagates its exit status. Validation can no longer offer a dependency installation mid-deploy.
- Fresh audit also identified Glob cancellation GHSA-3g3m-2fjr-6pw4 and minimatch amplification GHSA-g3hv-75wg-m249. Scoped overrides replace glob 13.0.6 with 14.0.2 and minimatch 10.2.6 with 11.0.1. These cross upstream major ranges; compatibility is checked through Expo validation, native fingerprint generation, web export and app tests. No audit exception was added.

Primary advisory references:
- https://github.com/advisories/GHSA-3g3m-2fjr-6pw4
- https://github.com/advisories/GHSA-g3hv-75wg-m249

## Windows recovery

Preserve the failed installer edits to package.json/package-lock.json in a stash before switching to the repair branch. Keep that stash for inspection; applying it wholesale would restore the failing dependency definitions. After checking out the repair, run normal `npm ci`, `npm run check:expo` and `npm run deploy:staging`.

Local verification: fresh `npm ci` with postinstall enabled, both security backports, Expo compatibility, dependency audit (root findings locally remediated, Worker zero), 318 unit/backend tests, app/Worker TypeScript, lint, formatting, web export and Android/iOS fingerprint generation passed. Expo compatibility was also checked under Node 24.11.1 on Linux; this is not a Windows runtime test or physical native build acceptance.

Production release evidence remains a separate gate. Do not copy the new commit SHA into an old report as a substitute for acceptance. Existing operational evidence must satisfy the checked-out candidate and release policy. Native dependencies changed; validate new native builds and choose a new compatible runtime before publishing OTA updates to existing installations.

Four targeted desktop Chromium review/preview browser cases also passed after the update. A WebKit rerun was blocked before launch because its executable is absent in this workspace; no fresh WebKit or full-suite pass is claimed for these new dependency versions.

## Production preflight follow-up

The next SDK 58 compatibility set requires Expo 58.0.23, constants 58.0.15, linking 58.0.16, notifications 58.1.8, router 58.0.30, updates 58.0.21 and safe-area-context 5.11.1. The repository updates all seven and retains the live noninteractive compatibility check. Offline mode is not used to suppress version validation. Future SDK patch advisories can require further intentional package/lock updates.

Production preflight now resolves the installed Cloudflare workspace Wrangler package's declared binary and runs it with Node directly. It preserves --json and the complete SQL argument without npm exec or shell argument parsing. Output can contain an ANSI/CRLF Wrangler banner, but must contain exactly one unambiguous structured D1 result; normal migration/hold/in-flight validation still applies. Exit failures, malformed or ambiguous data do not pass preflight. The query has a 90-second process deadline and bounded output.

Regression tests exercise clean and banner-wrapped JSON, ambiguity, failed query results, missing migrations, unresolved publishing, and invoking the fake local Wrangler bin from a directory with spaces. These are local tests; they do not certify production database state or release acceptance. The private report's stale commit and blocked gates remain unresolved until actual acceptance is completed.

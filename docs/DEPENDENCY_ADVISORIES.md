# Dependency disposition — October 27, 2026

Engineering review is separate from the owner's release acceptance.

## Current result

- Worker: zero advisories; compatible Miniflare → Undici 7.30.1+ override retained.
- Root: three affected high-severity package entries (Zod, Expo CLI, Expo), all
  arising from **GHSA-mrhx-c7xc-m3w5**. `securityClear` remains false.
- Forge updated from 1.4.0 to compatible 1.4.2 in the lockfile. Fresh npm audit no
  longer reports its advisory. RSA signing/verification compatibility is tested.
  Its prior waiver is removed: reintroducing that advisory fails the audit gate.
- Playwright development/test tooling updated from 1.56.1 to 1.64.1 to exercise the current browser engines; application assertions are retained.
- Expo 58.0.20 and CLI 58.1.16 compatibility remains intact. The CLI still declares
  Zod `^3.25.76`; the registry's patched Zod 4 release is a major API change.
  It was not substituted blindly. Xcode UUID compatibility override is retained.

| Advisory | Scope | Disposition |
| --- | --- | --- |
| [Forge GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo signing/certificate tooling | Compatible 1.4.2 installed, signing regression tested, current audit clear for Forge. No waiver. |
| [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | Expo CLI development/MCP plugin schemas | Only exact Zod 3.25.76 is tracked until November 8, 2026. Use reviewed installed plugins/configuration. Owner's evidence-backed risk decision or compatible upstream remediation required before release. Not claimed fixed. |
| Earlier Undici findings | Worker development tooling | Compatible Undici 7.30.1+ override; Worker audit clean. |

`npm run audit:dependencies` audits both lockfiles and rejects unknown advisories,
a changed affected leaf version, registry failure or expiry. A baseline pass does
not mean a clean root security audit. `-- --release` additionally requires valid
version 2 release evidence and the explicit owner's decision, mitigations and
next review date in the referenced private report. No owner decision was invented.

# Dependency disposition

Reviewed October 25, 2026 on `fix/release-acceptance`, using fresh root and Worker
registry audits and the installed dependency graph. Engineering triage is not an
owner's security acceptance for release.

## Current result

- Worker: **zero advisories**, after a scoped `miniflare → undici@^7.30.1` override.
  This retains Undici 7's API. Worker typecheck, bundling and regression tests run
  against this version. It does not replace the Worker's native Cloudflare fetch.
- Root: **6 high affected package entries**, representing **two underlying
  advisories**. Four parent entries are Expo CLI/certificate/update dependencies.
- Expo SDK 58 compatibility is retained. No forced Expo downgrade or Zod major
  override was applied. The existing tested Xcode UUID override remains.

| Advisory | Installed scope | Disposition and release requirement |
| --- | --- | --- |
| [Forge GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | `node-forge@1.4.0`, through Expo CLI iOS signing and `@expo/code-signing-certificates` | Registry latest is still affected. Retain supported Expo tooling; use only controlled signing keys/certificates and trusted build inputs. **Release blocked pending an owner's recorded risk decision or compatible upstream patch.** This finding is not claimed fixed. |
| [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | `zod@3.25.76`, through Expo CLI dev-tools plugin metadata schemas | Patched 4.6.6+ is a major API change from Expo CLI's dependency. Do not blindly substitute it. Use only reviewed installed CLI plugins/configuration; do not load untrusted development plugins. **Owner disposition required for release.** |
| [Undici GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c), plus EventSource/SRI advisories | Worker development tooling, Miniflare's Undici 7 | **Patched** to compatible 7.30.1+. Worker audit is clean. |
| Earlier braces, decode-uri-component and UUID findings | Historical SDK 57 dependency chain | Not reported by the current SDK 58 audit. No historical waiver carries over. |

`npm run audit:dependencies` audits both lockfiles. CI permits only these two
explicitly tracked root issues at the exact reviewed leaf package versions;
unknown advisories, failed registry responses, changed affected versions, or
expired review fail the job. Tracking expires **November 8, 2026** and must be
reassessed. A passing code CI does **not** mean the root security audit is clean.

`npm run audit:dependencies -- --release` additionally requires the accepted
release evidence file with an explicit owner risk decision. Record the decision,
mitigations, reviewer and next review date in its private evidence reference.
Do not mark the advisory gate passed until that review actually occurs.

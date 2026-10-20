# Dependency advisory triage

Reviewed October 20, 2026 for the pilot-readiness branch.

Expo SDK 57 dependencies were aligned using the SDK compatibility map, including
linking and web-browser packages previously on older SDK majors. TypeScript is on
the expected SDK version; the deprecated baseUrl setting was removed in favor of
relative paths. `expo-web-browser` is explicitly configured as a native plugin.
The Worker lockfile received compatible audit fixes and reports zero advisories.

Root `npm audit fix` was applied without force. The remaining reported graph has
24 affected packages (14 high, 10 moderate), arising from the advisories below.
This count includes transitive parent packages; it is not 24 independent defects.
No unsupported SDK downgrade, major dependency override or audit suppression was
used to manufacture a clean report. Re-run audits on the release commit because
registry advisory data changes independently of source control.

| Advisory | Dependency and scope found in this project | Disposition |
| --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | braces through Metro/build tooling; deeply nested glob denial of service | No patched compatible version reported. Keep builds on trusted source and configuration; revisit before pilot acceptance. |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | node-forge through Expo code-signing tooling; RSA signature validation | No patched compatible version reported. Native release/signing workflow needs review; no security acceptance inferred. |
| [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | decode-uri-component through query-string / Expo Router; malformed URI denial of service | Runtime reachability is not disproven. Treat as unresolved pilot risk; require a compatible patched dependency or a reviewed mitigation. |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | uuid through xcode/native project tooling; buffer bounds with supplied output buffers | Tooling dependency uses an older major. Do not force a breaking override without testing native builds and call sites. |

Before closing this gate, attach fresh root and Worker audit summaries, confirm
patched package availability, and obtain a documented risk disposition for anything
remaining. Test Android and iOS builds after any native-tooling update. Green app
CI demonstrates the configured tests, not resolution of these advisories.

Reference: [Expo dependency validation](https://docs.expo.dev/more/expo-cli/).

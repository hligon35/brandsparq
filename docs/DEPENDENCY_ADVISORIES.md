# Dependency advisory triage

Reviewed October 20, 2026 for the pilot-readiness branch.

Expo SDK 57 dependencies were aligned using the SDK compatibility map, including
linking and web-browser packages previously on older SDK majors. TypeScript is on
the expected SDK version; the deprecated baseUrl setting was removed in favor of
relative paths. `expo-web-browser` is explicitly configured as a native plugin.
The Worker lockfile received compatible audit fixes and reports zero advisories.

Root `npm audit fix` was applied without force. A scoped `xcode → uuid@11.1.1`
override now removes the UUID advisory while retaining the CommonJS `v4` API used
by Xcode. The actual Xcode project generator is regression-tested for valid,
unique project IDs. No Expo/React Native SDK change was needed.

The current root audit reports **17 affected packages (14 high, 3 moderate)**,
down from 24. The counts include transitive parent packages rather than independent
vulnerabilities. Native builds remain unverified on devices; the tooling test is
not a substitute for that gate. Re-run audits on the release commit because
registry advisory data changes independently of source control.

| Advisory | Dependency and scope found in this project | Disposition |
| --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | braces through Metro/build tooling; deeply nested glob denial of service | No patched compatible version reported. Keep builds on trusted source and configuration; revisit before pilot acceptance. |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | node-forge through Expo code-signing tooling; RSA signature validation | No patched compatible version reported. Native release/signing workflow needs review; no security acceptance inferred. |
| [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | decode-uri-component through CommonJS query-string 7 / Expo Router; malformed URI denial of service | Upstream patches this in 0.5.0, but it is ESM and does not preserve the callable CommonJS export used by query-string 7. A blind override would break routing. Remains unresolved pending a compatible upstream integration or reviewed mitigation. |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | uuid through xcode/native project tooling | Resolved in the lockfile with the scoped 11.1.1 override. Xcode calls only `v4`; CommonJS loading and project ID generation pass. Full device validation remains a separate requirement. |

Before closing this gate, attach fresh root and Worker audit summaries, confirm
patched package availability, and obtain a documented risk disposition for anything
remaining. Test Android and iOS builds after any native-tooling update. Green app
CI demonstrates the configured tests, not resolution of these advisories.

Reference: [Expo dependency validation](https://docs.expo.dev/more/expo-cli/).

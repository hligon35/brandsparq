# Expo toolchain security backports

Upstream package identities and versions stay unchanged. `npm audit` therefore continues to report upstream advisories. These are **local source remediations**, not upstream fixed releases or owner risk exceptions.

## Sources and changes

- deepmerge 4.3.1, MIT: https://github.com/TehShrike/deepmerge/tree/v4.3.1 . Advisory https://github.com/advisories/GHSA-gcqx-w48m-w2h4 . All three distributed JavaScript entry points define copied/merged keys as own data properties. Neither source nor target `__proto__` keys invoke the inherited setter or change the returned object's prototype. Arrays, symbols, custom merge hooks and `all` retain their existing behavior.
- Zod 3.25.76, MIT: https://github.com/colinhacks/zod/tree/v3.25.76 . Advisory https://github.com/advisories/GHSA-mrhx-c7xc-m3w5 . Both CJS/ESM v3 and bundled v4 runtime exports reject oversized arrays/sets/maps **before** element validation or output allocation. Existing array/set maximum/exact constraints run early. A toolchain-wide 10,000-element ceiling also covers otherwise unbounded collections, including maps. This is an intentional bound on Expo tooling configuration, not a new app input limit. Ordinary schema identity and Zod 3 compatibility are retained; no Zod 4 override is installed. Runtime exports used by Expo are covered; development-only `@zod/source` TypeScript sources are not the deployed runtime.

The upstream MIT notices are retained alongside these artifacts. Full patched source files are included so installation does not depend on a patch executable, an optional network service or a new lifecycle dependency. Each manifest entry records its exact upstream and patched SHA-256. The comments marked BrandSparQ identify the Zod backports; the deepmerge change is assignment to `Object.defineProperty`.

## Installation and verification

`npm ci` runs `postinstall`. Only the exact expected upstream bytes can be replaced. Applying already patched bytes is idempotent. Changed package versions, unknown upstream bytes and altered patch payloads fail closed. After installing with scripts disabled, explicitly run `node scripts/patch-toolchain.mjs` before using the Expo toolchain.

`npm run verify:toolchain`, the dependency gate and release verification check the installed source hashes again. A top-level verified backport only remediates that exact advisory/package path; an affected nested copy or an unknown advisory still blocks or requires explicit unresolved-advisory disposition. Raw audit counts are printed alongside locally remediated IDs, never relabeled as a zero-vulnerability registry report. The Worker dependency audit must remain completely clean.

`tests/toolchain-backports.test.mjs` covers CJS/ESM sync/async collection admission, rejection before element transforms, valid configuration compatibility, hostile deepmerge target/source prototypes, arrays/symbols/custom merge hooks, tampered installations, nested packages and unknown advisories. Expo config, dependency compatibility, exports and the browser suite provide integration coverage.

Review or remove these backports when upgrading Expo/Zod/deepmerge. An upstream version change deliberately stops installation until the patch manifest and regressions are reviewed. Owner acceptance of staging/device/provider/restore release evidence remains required; these backports do not authorize deployment.

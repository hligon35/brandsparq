import { verifyToolchainPatches } from "./lib/toolchain-patches.mjs";
console.log(
  JSON.stringify({
    verifiedBackports: verifyToolchainPatches({ apply: !process.argv.includes("--check") }),
  }),
);

import { execFileSync } from "node:child_process";

export function verifyCheckout(commit, cwd = process.cwd()) {
  const git = (args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  if (git(["rev-parse", "HEAD"]) !== commit || git(["status", "--porcelain"]))
    throw new Error(
      "Release source changed during validation. Commit the changes and rerun acceptance before deploying.",
    );
}

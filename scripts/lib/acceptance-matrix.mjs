import { readFileSync } from "node:fs";
const app = JSON.parse(readFileSync(new URL("../../app.json", import.meta.url), "utf8")).expo;
export const DEVICE_CHECKS = [
  "cold_start",
  "oauth_cold",
  "oauth_warm",
  "deep_links",
  "session_restore",
  "session_expiry",
  "sign_out",
  "photo_permission_denied",
  "png_jpeg_heic_upload",
  "background_generation",
  "review_calendar",
  "offline_reconnect",
  "push_receipt_tap",
  "ota_matching_runtime",
  "ota_wrong_runtime",
];
export const PROVIDER_CHECKS = [
  "oauth",
  "create_review_publish",
  "duplicate_delivery",
  "rate_limit",
  "token_revocation",
  "delayed_receipt",
  "uncertain_reconciliation",
  "disconnect_reconnect",
  "analytics",
  "webhook_signature_replay",
];
export function evidenceReference(value) {
  try {
    const url = new URL(value);
    return (
      typeof value === "string" &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/^(localhost|127\.|\[::1\])/.test(url.hostname)
    );
  } catch {
    return false;
  }
}
export function verifyChecks(
  checks,
  required,
  { now = Date.now(), label, notApplicable = [] } = {},
) {
  for (const name of required) {
    const check = checks?.[name];
    const captured = Date.parse(check?.recordedAt);
    if (
      !check ||
      (check.status !== "passed" &&
        !(check.status === "not_applicable" && notApplicable.includes(name))) ||
      !Number.isFinite(captured) ||
      captured > now ||
      now - captured > 7 * 86400000 ||
      !evidenceReference(check.evidenceUrl) ||
      typeof check.summary !== "string" ||
      check.summary.trim().length < 10
    )
      throw new Error(`Record current acceptance evidence for ${label}.${name}.`);
  }
}
export function verifyAcceptanceMatrix(report, { now = Date.now() } = {}) {
  if (report.attestationVersion !== 2)
    throw new Error(
      "Release evidence requires attestationVersion 2 and the complete acceptance matrix.",
    );
  for (const platform of ["android", "ios"]) {
    const gate = report.gates?.[platform];
    if (
      gate?.buildProfile !== "staging" ||
      gate.channel !== "staging" ||
      app.runtimeVersion?.policy !== "appVersion" ||
      gate.runtimeVersion !== app.version ||
      gate.apiOrigin !== report.stagingOrigin ||
      gate.fixtureBuild !== false ||
      gate.physicalDevice !== true
    )
      throw new Error(
        `Record the physical staging build, channel, runtime and isolated API for ${platform}.`,
      );
    verifyChecks(gate.checks, DEVICE_CHECKS, { now, label: platform });
  }
  const providers = report.gates?.providers;
  for (const name of providers?.accepted || []) {
    const detail = providers.results?.[name];
    if (
      !detail ||
      !detail.clientId ||
      !detail.socialAccountId ||
      !detail.providerPostId ||
      !evidenceReference(detail.providerPostUrl)
    )
      throw new Error(
        `Record accepted destination identity and actual provider receipt for ${name}.`,
      );
    verifyChecks(detail.checks, PROVIDER_CHECKS, {
      now,
      label: name,
      notApplicable: ["facebook", "instagram"].includes(name) ? [] : ["webhook_signature_replay"],
    });
  }
  const restore = report.gates?.restore;
  if (
    restore?.disconnected !== true ||
    restore.liveSessionsRevoked !== true ||
    !/^[a-f0-9]{64}$/.test(restore.sqlSha256 || "") ||
    !/^[a-f0-9]{64}$/.test(restore.inventorySha256 || "") ||
    !Number.isSafeInteger(restore.mediaObjects) ||
    restore.mediaObjects < 0 ||
    restore.missingObjects !== 0 ||
    restore.corruptObjects !== 0 ||
    restore.foreignKeysVerified !== true
  )
    throw new Error(
      "Record disconnected restoration, source hashes, complete media verification, session isolation and foreign-key checks.",
    );
}
export async function verifyHostedCI(gate, commit, { fetcher = fetch } = {}) {
  if (!Number.isSafeInteger(gate?.runId) || gate.runId <= 0)
    throw new Error("Record the successful GitHub Actions run ID.");
  const url = `https://api.github.com/repos/hligon35/brandsparq/actions/runs/${gate.runId}`;
  const response = await fetcher(url, {
    redirect: "error",
    headers: { accept: "application/vnd.github+json", "user-agent": "BrandSparQ-release-verifier" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Could not verify hosted CI; release remains blocked.");
  const run = await response.json();
  if (
    run.id !== gate.runId ||
    run.repository?.full_name !== "hligon35/brandsparq" ||
    run.head_sha !== commit ||
    run.path !== ".github/workflows/ci.yml" ||
    run.name !== "BrandSparQ CI" ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  )
    throw new Error("Hosted CI has not passed for this exact release commit.");
  return { runId: run.id, commit, conclusion: "success" };
}

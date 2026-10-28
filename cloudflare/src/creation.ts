import { renewClientDestinations } from "./social";
import { validTimezone } from "./settings-validation";
import type { SessionUser } from "./auth";
import { hasClientPermission } from "./authz";
import { dispatchGeneration } from "./generation-dispatch";
import type { GenerationEnv } from "./generation";

type Env = GenerationEnv & Record<string, any>;
export const CREATION_PLATFORMS = ["facebook", "instagram", "linkedin", "tiktok", "x"];
export type CreationOptions = {
  mode: "social" | "campaign";
  outputCount: number;
  destinations: { id: string; platform: string }[];
};

function providerReady(env: Env, platform: string) {
  if (platform === "facebook" || platform === "instagram")
    return !!(env.META_APP_ID && env.META_APP_SECRET);
  if (platform === "linkedin") return !!(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
  if (platform === "tiktok") return !!(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);
  return !!env.X_CLIENT_ID;
}
export async function creationReadiness(env: Env, clientId: string) {
  const client =
    await env.DB.prepare(`SELECT c.id,c.status,c.timezone,b.voice,b.audience,b.logo_asset_id FROM clients c
    LEFT JOIN brand_profiles b ON b.client_id=c.id WHERE c.id=?`)
      .bind(clientId)
      .first<any>();
  const blockers: string[] = [];
  if (!client || client.status !== "active") blockers.push("Choose an active client.");
  if (client && !validTimezone(client.timezone))
    blockers.push("Set a valid client time zone before generating.");
  if (client?.logo_asset_id) {
    const logo = await env.DB.prepare(
      "SELECT r2_key,content_type FROM assets WHERE id=? AND client_id=?",
    )
      .bind(client.logo_asset_id, clientId)
      .first<any>();
    if (!logo?.content_type?.startsWith("image/") || !(await env.MEDIA.head(logo.r2_key)))
      blockers.push("The selected brand logo is missing or invalid. Update it in Brand Brain.");
  }
  if (!client?.voice?.trim() || !client?.audience?.trim())
    blockers.push("Add Brand Brain voice and audience before generating.");
  if (!env.OPENAI_API_KEY)
    blockers.push(
      "Creative generation is not configured. Ask the workspace owner to configure it.",
    );
  try {
    await renewClientDestinations(env, clientId);
  } catch {
    blockers.push(
      "Publishing access could not be renewed. Retry shortly or verify the connection.",
    );
  }
  const accounts =
    await env.DB.prepare(`SELECT id,platform,account_name,status,health_status,token_expires_at,is_default,
    access_token_ciphertext IS NOT NULL AS has_token FROM social_accounts WHERE client_id=? ORDER BY platform,is_default DESC,account_name,id`)
      .bind(clientId)
      .all<any>();
  const destinations = accounts.results.map((account) => {
    const issues: string[] = [];
    if (
      account.status !== "connected" ||
      ["reauth_required", "disconnected", "degraded"].includes(account.health_status)
    )
      issues.push("Reconnect or verify this account.");
    if (
      !account.has_token ||
      (account.token_expires_at && Number(account.token_expires_at) <= Date.now())
    )
      issues.push("Reconnect this account to renew publishing access.");
    if (!providerReady(env, account.platform))
      issues.push("Provider credentials are not configured. Ask the workspace owner.");
    const { has_token: _, ...safe } = account;
    return { ...safe, ready: !issues.length, issues };
  });
  if (!destinations.some((d) => d.ready))
    blockers.push("Connect and verify at least one publishing destination.");
  return {
    ready: !blockers.length,
    blockers,
    visualReviewRequired: true,
    brandingNotice:
      "AI graphics can alter logos and lettering. Inspect and approve the image before publishing; exact logo reproduction is not guaranteed.",
    warnings: client?.logo_asset_id
      ? []
      : ["No brand logo is selected; graphics will be generated without a logo."],
    destinations,
  };
}

export async function handleCreationRoute(request: Request, url: URL, env: Env, user: SessionUser) {
  const readiness = url.pathname.match(/^\/v1\/clients\/([^/]+)\/creation-readiness$/);
  if (readiness && request.method === "GET") {
    if (!(await hasClientPermission(env.DB, user, "generate", readiness[1])))
      return { body: { error: "Generation permission is required." }, status: 403 };
    return { body: { data: await creationReadiness(env, readiness[1]) } };
  }
  if (url.pathname !== "/v1/creation-jobs" || request.method !== "POST") return null;
  const p = await request.json<any>().catch(() => null);
  if (
    !p ||
    typeof p.clientId !== "string" ||
    !["social", "campaign"].includes(p.mode) ||
    !Number.isInteger(p.outputCount) ||
    (p.mode === "social" ? p.outputCount !== 1 : p.outputCount < 3 || p.outputCount > 5) ||
    typeof p.objective !== "string" ||
    !p.objective.trim() ||
    p.objective.length > 2000 ||
    typeof p.requestKey !== "string" ||
    !/^[a-zA-Z0-9_-]{16,128}$/.test(p.requestKey) ||
    !Array.isArray(p.assetIds) ||
    !p.assetIds.length ||
    p.assetIds.length > 20 ||
    p.assetIds.some((id: unknown) => typeof id !== "string" || !id) ||
    new Set(p.assetIds).size !== p.assetIds.length ||
    !Array.isArray(p.destinationIds) ||
    !p.destinationIds.length ||
    p.destinationIds.length > p.outputCount ||
    p.destinationIds.some((id: unknown) => typeof id !== "string") ||
    new Set(p.destinationIds).size !== p.destinationIds.length
  )
    return {
      body: {
        error: "Choose a creation mode, valid output count, images and publishing destinations.",
      },
      status: 400,
    };
  if (!(await hasClientPermission(env.DB, user, "generate", p.clientId)))
    return { body: { error: "Generation permission is required." }, status: 403 };
  // A lost response must return its durable job even if readiness changed since acceptance.
  const existing = await env.DB.prepare(
    "SELECT * FROM generation_jobs WHERE requested_by=? AND request_key=?",
  )
    .bind(user.id, p.requestKey)
    .first<any>();
  const assetIds = JSON.stringify([...p.assetIds].sort());
  const matches = (job: any) => {
    const options = JSON.parse(job.creation_options || "null");
    return (
      job.client_id === p.clientId &&
      job.objective === p.objective &&
      job.asset_ids === assetIds &&
      options?.mode === p.mode &&
      options.outputCount === p.outputCount &&
      JSON.stringify(options.destinations.map((d: any) => d.id).sort()) ===
        JSON.stringify([...p.destinationIds].sort())
    );
  };
  if (existing)
    return matches(existing)
      ? { body: { ok: true, jobId: existing.id, status: existing.status }, status: 202 }
      : { body: { error: "This request identity belongs to different content." }, status: 409 };
  const ready = await creationReadiness(env, p.clientId);
  const targets = ready.destinations.filter((d) => p.destinationIds.includes(d.id));
  if (
    !ready.ready ||
    targets.length !== p.destinationIds.length ||
    targets.some((d) => !d.ready) ||
    new Set(targets.map((d) => d.platform)).size !== targets.length
  )
    return {
      body: {
        error:
          ready.blockers.join(" ") ||
          "Choose one ready destination per platform belonging to this client.",
        readiness: ready,
      },
      status: 409,
    };
  const assets = await env.DB.prepare(
    `SELECT id,r2_key,content_type FROM assets WHERE client_id=? AND id IN (${p.assetIds.map(() => "?").join(",")})`,
  )
    .bind(p.clientId, ...p.assetIds)
    .all<any>();
  if (
    assets.results.length !== p.assetIds.length ||
    assets.results.some((a) => !a.content_type?.startsWith("image/"))
  )
    return { body: { error: "Select image assets owned by this client." }, status: 400 };
  for (const asset of assets.results)
    if (!(await env.MEDIA.head(asset.r2_key)))
      return {
        body: { error: "A source image is missing. Remove it and upload it again." },
        status: 409,
      };
  const candidate = crypto.randomUUID();
  const options: CreationOptions = {
    mode: p.mode,
    outputCount: p.outputCount,
    destinations: targets
      .map((d) => ({ id: d.id, platform: d.platform }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  await env.DB.prepare(`INSERT OR IGNORE INTO generation_jobs(id,client_id,requested_by,objective,asset_ids,status,request_key,creation_options)
    SELECT ?,?,?,?,?,'queued',?,? FROM clients WHERE id=? AND status='active'`)
    .bind(
      candidate,
      p.clientId,
      user.id,
      p.objective,
      assetIds,
      p.requestKey,
      JSON.stringify(options),
      p.clientId,
    )
    .run();
  const job = await env.DB.prepare(
    "SELECT * FROM generation_jobs WHERE requested_by=? AND request_key=?",
  )
    .bind(user.id, p.requestKey)
    .first<any>();
  if (!job || !matches(job))
    return {
      body: { error: "The request changed or client is unavailable. Refresh and try again." },
      status: 409,
    };
  if (job.id === candidate) await dispatchGeneration(env, job.id);
  const current = await env.DB.prepare(
    "SELECT status,error_message FROM generation_jobs WHERE id=?",
  )
    .bind(job.id)
    .first<any>();
  return {
    body: { ok: true, jobId: job.id, status: current.status, error: current.error_message },
    status: 202,
  };
}

import type { SessionUser } from "./auth";
import {
  PILOT_EVIDENCE,
  type PilotConfiguration,
  type PilotOverview,
} from "../../src/shared/pilot";

type Env = { DB: D1Database };
export async function getPilot(env: Env) {
  const row = await env.DB.prepare("SELECT * FROM pilot_settings WHERE id='default'").first<any>();
  if (!row)
    throw new Error("Pilot settings are unavailable. Apply the pilot migration before publishing.");
  return row;
}

export async function pilotOverview(env: Env): Promise<PilotOverview> {
  const row = await getPilot(env);
  const [destinations, available, inFlight] = await Promise.all([
    env.DB.prepare(
      "SELECT client_id AS clientId,social_account_id AS socialAccountId FROM pilot_destinations",
    ).all<any>(),
    env.DB.prepare(`SELECT c.id AS clientId,c.name AS clientName,s.id AS socialAccountId,s.platform,s.account_name AS accountName
      FROM clients c JOIN social_accounts s ON s.client_id=c.id
      WHERE c.status='active' AND s.status='connected' ORDER BY c.name,s.platform,s.account_name`).all<any>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM publish_jobs WHERE status='publishing'").first<{
      count: number;
    }>(),
  ]);
  return {
    mode: row.mode,
    revision: row.revision,
    endsAt: row.ends_at,
    expired: row.mode === "supervised" && (!row.ends_at || Date.parse(row.ends_at) <= Date.now()),
    releaseCommit: row.release_commit,
    evidence: JSON.parse(row.evidence_json),
    destinations: destinations.results,
    availableDestinations: available.results,
    inFlight: Number(inFlight?.count || 0),
  };
}

export async function pilotPublishError(env: Env, user: SessionUser, postId: string) {
  const config = await getPilot(env);
  if (config.mode === "normal") return null;
  if (config.mode !== "supervised" || !config.ends_at || Date.parse(config.ends_at) <= Date.now())
    return "Publishing is on hold. An owner must configure an accepted, unexpired pilot.";
  if (user.role !== "owner") return "A workspace owner must supervise each pilot publish.";
  const destination =
    await env.DB.prepare(`SELECT 1 AS ok FROM posts p JOIN pilot_destinations d ON d.client_id=p.client_id AND d.social_account_id=p.social_account_id
    JOIN social_accounts s ON s.id=d.social_account_id AND s.client_id=p.client_id AND s.status='connected' WHERE p.id=?`)
      .bind(postId)
      .first();
  if (!destination) return "This client destination is outside the supervised pilot.";
  const used =
    await env.DB.prepare(`SELECT COUNT(*) AS count FROM publish_jobs j JOIN posts history ON history.id=j.post_id
    WHERE history.client_id=(SELECT client_id FROM posts WHERE id=?) AND date(j.first_claimed_at)=date('now')`)
      .bind(postId)
      .first<{ count: number }>();
  return Number(used?.count || 0) > 0
    ? "This pilot client has reached its publishing limit for today (UTC)."
    : null;
}

export async function pilotInvitationError(env: Env, clientIds: string[]) {
  const config = await getPilot(env);
  if (config.mode === "normal") return null;
  if (config.mode !== "supervised" || !config.ends_at || Date.parse(config.ends_at) <= Date.now())
    return "New invitations are on hold until an owner configures an accepted pilot.";
  if (!clientIds.length) return "A pilot invitation requires an approved client assignment.";
  for (const id of clientIds)
    if (
      !(await env.DB.prepare("SELECT client_id FROM pilot_destinations WHERE client_id=?")
        .bind(id)
        .first())
    )
      return "Invitations are limited to approved pilot clients.";
  return null;
}

function evidenceUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function configurePilot(env: Env, user: SessionUser, inputValue: unknown) {
  const input = inputValue as PilotConfiguration | null;
  if (user.role !== "owner") return { body: { error: "Owner access is required." }, status: 403 };
  if (
    !input ||
    !["hold", "supervised"].includes(input.mode) ||
    !Number.isSafeInteger(input.expectedRevision)
  )
    return {
      body: { error: "Choose hold or supervised and supply the current revision." },
      status: 400,
    };
  const row = await getPilot(env);
  if (row.revision !== input.expectedRevision)
    return { body: { error: "Pilot settings changed. Refresh before saving." }, status: 409 };
  const destinations = input.destinations;
  let evidence: Record<string, string> = {};
  let endsAt: string | null = null;
  if (input.mode === "supervised") {
    const end = typeof input.endsAt === "string" ? Date.parse(input.endsAt) : NaN;
    if (
      !Number.isFinite(end) ||
      end <= Date.now() ||
      end > Date.now() + 7 * 86400000 ||
      !/^[a-f0-9]{40}$/i.test(input.releaseCommit || "")
    )
      return {
        body: {
          error: "Provide the accepted release commit and a future pilot end within seven days.",
        },
        status: 400,
      };
    if (
      !Array.isArray(destinations) ||
      destinations.length < 1 ||
      destinations.length > 2 ||
      new Set(destinations.map((d) => d?.clientId)).size !== destinations.length
    )
      return {
        body: { error: "Choose one destination for each of one or two pilot clients." },
        status: 400,
      };
    for (const item of PILOT_EVIDENCE) {
      const reference = evidenceUrl(input.evidence?.[item.id]);
      if (!reference)
        return {
          body: {
            error: `Provide a private HTTPS evidence reference without query parameters for ${item.label}.`,
          },
          status: 400,
        };
      evidence[item.id] = reference;
    }
    for (const d of destinations) {
      if (
        typeof d?.clientId !== "string" ||
        typeof d.socialAccountId !== "string" ||
        !(await env.DB.prepare(`SELECT s.id FROM social_accounts s JOIN clients c ON c.id=s.client_id
        WHERE s.id=? AND c.id=? AND c.status='active' AND s.status='connected'`)
          .bind(d.socialAccountId, d.clientId)
          .first())
      )
        return {
          body: { error: "Choose connected destinations belonging to active clients." },
          status: 400,
        };
    }
    endsAt = new Date(end).toISOString();
  }
  const revision = row.revision + 1;
  const mutationToken = crypto.randomUUID();
  // All dependent changes are fenced by the exact settings revision and unique mutation token.
  // This is operator-attested evidence, not a claim that the Worker ran device or provider tests.
  const fence =
    "EXISTS(SELECT 1 FROM pilot_settings WHERE id='default' AND revision=? AND mutation_token=?)";
  const statements = [
    env.DB.prepare(
      `UPDATE pilot_settings SET mode=?,revision=revision+1,ends_at=?,release_commit=?,evidence_json=?,updated_by=?,mutation_token=?,updated_at=CURRENT_TIMESTAMP WHERE id='default' AND revision=?`,
    ).bind(
      input.mode,
      endsAt,
      input.mode === "supervised" ? input.releaseCommit : row.release_commit,
      input.mode === "supervised" ? JSON.stringify(evidence) : row.evidence_json,
      user.id,
      mutationToken,
      input.expectedRevision,
    ),
    env.DB.prepare(`UPDATE posts SET paused_from_status=status,status='paused',publish_version=publish_version+1,updated_at=CURRENT_TIMESTAMP
      WHERE status IN ('calendar_scheduled','pre_publish','rescheduled','publish_queued') AND ${fence}
      AND NOT EXISTS(SELECT 1 FROM publish_jobs j WHERE j.post_id=posts.id AND j.status='publishing')`).bind(
      revision,
      mutationToken,
    ),
    env.DB.prepare(`UPDATE publish_jobs SET status='canceled',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE status IN ('queued','retrying') AND ${fence}`).bind(revision, mutationToken),
  ];
  if (input.mode === "supervised") {
    statements.push(
      env.DB.prepare(
        `UPDATE workspace_settings SET default_no_response_policy='hold' WHERE id='default' AND ${fence}`,
      ).bind(revision, mutationToken),
    );
    statements.push(
      env.DB.prepare(`DELETE FROM pilot_destinations WHERE ${fence}`).bind(revision, mutationToken),
    );
    for (const d of destinations!)
      statements.push(
        env.DB.prepare(
          `INSERT INTO pilot_destinations(client_id,social_account_id) SELECT ?,? WHERE ${fence}`,
        ).bind(d.clientId, d.socialAccountId, revision, mutationToken),
      );
  }
  if (input.mode === "supervised")
    statements.push(
      env.DB.prepare(`INSERT INTO client_settings(client_id,no_response_policy)
        SELECT client_id,'hold' FROM pilot_destinations WHERE ${fence}
        ON CONFLICT(client_id) DO UPDATE SET no_response_policy='hold'`).bind(
        revision,
        mutationToken,
      ),
    );
  statements.push(
    env.DB.prepare(`INSERT INTO recovery_actions(id,actor_user_id,action,entity_type,entity_id,metadata_json)
    SELECT ?,?,'configure_pilot','system','brandsparq',? WHERE ${fence}`).bind(
      crypto.randomUUID(),
      user.id,
      JSON.stringify({
        mode: input.mode,
        revision,
        endsAt,
        releaseCommit: input.mode === "supervised" ? input.releaseCommit : row.release_commit,
        clientIds: input.mode === "supervised" ? destinations!.map((d) => d.clientId) : [],
        destinations: input.mode === "supervised" ? destinations : undefined,
        evidence: input.mode === "supervised" ? evidence : undefined,
      }),
      revision,
      mutationToken,
    ),
  );
  const [changed] = await env.DB.batch(statements);
  if (!changed.meta.changes)
    return { body: { error: "Pilot settings changed. Refresh before saving." }, status: 409 };
  return { body: { ok: true, data: await pilotOverview(env) } };
}

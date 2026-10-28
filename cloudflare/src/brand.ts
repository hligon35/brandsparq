import { validTimezone } from "./settings-validation";
import { validRevision, revisionRequired, revisionConflict } from "./revisions";

type Env = { DB: D1Database };
const fields: Record<string, string> = {
  voice: "voice",
  audience: "audience",
  primaryColor: "primary_color",
  secondaryColor: "secondary_color",
  website: "website",
  restrictedWords: "restricted_words",
  tagline: "tagline",
  preferredCtas: "preferred_ctas",
  imageryPreferences: "imagery_preferences",
  postingRules: "posting_rules",
  fonts: "fonts",
  brandExamples: "brand_examples",
  prohibitedVisualStyles: "prohibited_visual_styles",
  competitorReferences: "competitor_references",
  brandVocabulary: "brand_vocabulary",
  hashtagPolicy: "hashtag_policy",
  targetLocations: "target_locations",
  platformRules: "platform_rules",
  logoAssetId: "logo_asset_id",
  alternateLogoAssetId: "alternate_logo_asset_id",
  logoPreference: "logo_preference",
  socialHandles: "social_handles",
  ctaLibrary: "cta_library",
  campaignGoals: "campaign_goals",
};
const jsonFields = new Set(["socialHandles", "ctaLibrary", "campaignGoals"]);
export async function saveBrandProfile(env: Env, clientId: string, payload: any) {
  if (!payload || !validRevision(payload.expectedRevision)) return revisionRequired;
  if (
    payload.name !== undefined &&
    (typeof payload.name !== "string" || !payload.name.trim() || payload.name.length > 200)
  )
    return { status: 400, body: { error: "Enter a client name between 1 and 200 characters." } };
  if (payload.timezone !== undefined && !validTimezone(payload.timezone))
    return { status: 400, body: { error: "Choose a valid client time zone." } };
  const values: Record<string, string | null> = {};
  for (const [key, column] of Object.entries(fields)) {
    if (payload[key] === undefined) continue;
    const v = payload[key];
    if (jsonFields.has(key)) {
      if (v !== null && (typeof v !== "object" || JSON.stringify(v).length > 20000))
        return { status: 400, body: { error: `Check ${key}.` } };
      values[column] = v === null ? null : JSON.stringify(v);
    } else {
      if (v !== null && (typeof v !== "string" || v.length > 20000))
        return { status: 400, body: { error: `Check ${key}.` } };
      if (key === "logoPreference" && !["primary", "alternate"].includes(v))
        return { status: 400, body: { error: "Choose a primary or alternate logo." } };
      values[column] = v === "" ? null : v;
    }
  }
  for (const column of ["logo_asset_id", "alternate_logo_asset_id"]) {
    if (!values[column]) continue;
    if (
      !(await env.DB.prepare(
        "SELECT id FROM assets WHERE id=? AND client_id=? AND content_type LIKE 'image/%'",
      )
        .bind(values[column], clientId)
        .first())
    )
      return { status: 400, body: { error: "Logo must be an image owned by this client." } };
  }
  const token = crypto.randomUUID();
  // Every statement shares a D1 transaction. The token gates all writes on the editor's revision.
  const columns = Object.keys(values);
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE clients SET name=COALESCE(?,name),timezone=COALESCE(?,timezone),edit_token=?,schedule_revision=schedule_revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='active' AND edit_revision=?`).bind(
      payload.name?.trim() ?? null,
      payload.timezone ?? null,
      token,
      clientId,
      payload.expectedRevision,
    ),
    env.DB.prepare(`INSERT INTO brand_profiles(id,client_id${columns.length ? "," + columns.join(",") : ""})
      SELECT ?,?${columns.map(() => ",?").join("")} FROM clients WHERE id=? AND edit_token=?
      ON CONFLICT(client_id) DO UPDATE SET ${columns.map((c) => `${c}=excluded.${c},`).join("")}updated_at=CURRENT_TIMESTAMP`).bind(
      crypto.randomUUID(),
      clientId,
      ...Object.values(values),
      clientId,
      token,
    ),
  ]);
  if (!results[0].meta.changes) return revisionConflict;
  const data = await env.DB.prepare(
    "SELECT c.name,c.timezone,c.status AS client_status,c.edit_revision AS revision,b.* FROM clients c JOIN brand_profiles b ON b.client_id=c.id WHERE c.id=?",
  )
    .bind(clientId)
    .first();
  return { status: 200, body: { ok: true, data } };
}

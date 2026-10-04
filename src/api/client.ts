import { Platform } from "react-native";
import type { Asset, Client, MarketingPost, PrePublishDecision } from "@/types/domain";

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
const API_URL =
  configuredApiUrl ?? (Platform.OS === "web" ? "" : "http://localhost:8787");

let sessionToken: string | null = null;

export function setApiSessionToken(token: string | null) {
  sessionToken = token;
}

type AuthUser = {
  id: string;
  email: string;
  name?: string;
  role: string;
};

type ApiPost = {
  id: string;
  client_id: string;
  client_name?: string;
  client_color?: string;
  campaign_id?: string | null;
  platform: MarketingPost["platform"];
  status: MarketingPost["status"];
  title: string;
  caption: string;
  image_url?: string | null;
  suggested_publish_at?: string | null;
  scheduled_publish_at?: string | null;
  approved_at?: string | null;
  sparq_score?: number | null;
  prepublish_response?: PrePublishDecision | null;
  social_account_id?: string | null;
  social_account_name?: string | null;
};

export function resolveApiUrl(value?: string | null) {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return API_URL + (value.startsWith("/") ? value : "/" + value);
}

function mapPost(row: ApiPost): MarketingPost {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientColor: row.client_color,
    campaignId: row.campaign_id ?? undefined,
    platform: row.platform,
    status: row.status,
    title: row.title,
    caption: row.caption,
    imageUrl: resolveApiUrl(row.image_url),
    suggestedPublishAt: row.suggested_publish_at ?? undefined,
    scheduledPublishAt: row.scheduled_publish_at ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    sparqScore: row.sparq_score ?? undefined,
    prepublishResponse: row.prepublish_response ?? undefined,
    socialAccountId: row.social_account_id ?? undefined,
    socialAccountName: row.social_account_name ?? undefined,
  };
}

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (sessionToken) headers.set("authorization", `Bearer ${sessionToken}`);
  return headers;
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = authHeaders(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      (payload as { error?: string } | null)?.error ??
        `Request failed: ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}

export const api = {
  getGoogleAuthStartUrl(returnTo: string) {
    return `${API_URL}/v1/auth/google/start?return_to=${encodeURIComponent(returnTo)}`;
  },

  completeGoogleAuth: (handoff: string) =>
    jsonRequest<{
      token: string;
      expiresAt: number;
      user: AuthUser;
    }>("/v1/auth/google/complete", {
      method: "POST",
      body: JSON.stringify({ handoff }),
    }),

  getSession: () =>
    jsonRequest<{ user: AuthUser }>("/v1/auth/session"),

  signOut: () =>
    jsonRequest<{ ok: true }>("/v1/auth/logout", { method: "POST" }),


  getDashboard: () =>
    jsonRequest<{
      data: {
        needsReview: number;
        scheduled: number;
        publishingToday: number;
        failed: number;
        nextPost: (ApiPost & { client_name?: string }) | null;
      };
    }>("/v1/dashboard"),

  createClient: (name: string, timezone?: string) =>
    jsonRequest<{ ok: true; id: string; name: string; timezone: string }>(
      "/v1/clients",
      {
        method: "POST",
        body: JSON.stringify({ name, timezone }),
      }
    ),

  updateClient: (clientId: string, payload: { name?: string; timezone?: string }) =>
    jsonRequest<{ ok: true }>(`/v1/clients/${clientId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  archiveClient: (clientId: string) =>
    jsonRequest<{ ok: true }>(`/v1/clients/${clientId}/archive`, {
      method: "POST",
    }),

  getBrandAssets: (clientId: string) =>
    jsonRequest<{ data: any[] }>(`/v1/clients/${clientId}/brand-assets`),

  attachBrandAsset: (
    clientId: string,
    assetId: string,
    role: string,
    label?: string
  ) =>
    jsonRequest<{ ok: true; id: string }>(
      `/v1/clients/${clientId}/brand-assets`,
      {
        method: "POST",
        body: JSON.stringify({ assetId, role, label }),
      }
    ),

  getCampaigns: (clientId?: string) =>
    jsonRequest<{ data: any[] }>(
      `/v1/campaigns${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`
    ),

  getCampaign: (campaignId: string) =>
    jsonRequest<{ data: { campaign: any; posts: any[] } }>(
      `/v1/campaigns/${campaignId}`
    ),

  updateCampaign: (campaignId: string, payload: Record<string, unknown>) =>
    jsonRequest<{ ok: true }>(`/v1/campaigns/${campaignId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getSocialAccounts: (clientId?: string) =>
    jsonRequest<{ data: any[] }>(
      `/v1/social/accounts${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`
    ),

  getSocialConnectUrl(platform: string, clientId: string, returnTo: string) {
    return `${API_URL}/v1/social/connect?platform=${encodeURIComponent(platform)}&clientId=${encodeURIComponent(clientId)}&returnTo=${encodeURIComponent(returnTo)}`;
  },

  disconnectSocialAccount: (accountId: string) =>
    jsonRequest<{ ok: true }>(`/v1/social/accounts/${accountId}/disconnect`, {
      method: "POST",
    }),

  verifySocialAccount: (accountId: string) =>
    jsonRequest<{ ok: true; data: { health: string; checkedAt: string } }>(
      `/v1/social/accounts/${accountId}/verify`,
      { method: "POST" }
    ),

  assignSocialAccount: (postId: string, socialAccountId: string) =>
    jsonRequest<{ ok: true }>(`/v1/posts/${postId}/social-account`, {
      method: "POST",
      body: JSON.stringify({ socialAccountId }),
    }),

  getNotifications: () =>
    jsonRequest<{ data: any[] }>("/v1/notifications"),

  registerPushToken: (token: string, platform?: string, deviceName?: string) =>
    jsonRequest<{ ok: true }>("/v1/push-token", {
      method: "POST",
      body: JSON.stringify({ token, platform, deviceName }),
    }),

  getSettings: () =>
    jsonRequest<{ data: any }>("/v1/settings"),

  saveSettings: (payload: Record<string, unknown>) =>
    jsonRequest<{ ok: true }>("/v1/settings", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  testNotifications: () =>
    jsonRequest<{ ok: true }>("/v1/notifications/test", { method: "POST" }),

  getAnalyticsOverview: (clientId?: string) =>
    jsonRequest<{ data: any }>(
      `/v1/analytics/overview${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`
    ),

  syncAnalytics: (accountId?: string) =>
    jsonRequest<{ ok: true }>("/v1/analytics/sync", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    }),

  validateSchedule: (clientId: string, scheduledAt: string) =>
    jsonRequest<{ data: { requested: string; suggested: string; conflict: boolean } }>(
      `/v1/clients/${clientId}/schedule/validate`,
      { method: "POST", body: JSON.stringify({ scheduledAt }) }
    ),

  recommendSchedule: (clientId: string, desiredAt?: string) =>
    jsonRequest<{ data: { scheduledAt: string } }>(
      `/v1/clients/${clientId}/schedule/recommend`,
      { method: "POST", body: JSON.stringify({ desiredAt }) }
    ),

  getBrand: (clientId: string) =>
    jsonRequest<{ data: any }>(`/v1/clients/${clientId}/brand`),

  saveBrand: (clientId: string, brand: Record<string, unknown>) =>
    jsonRequest<{ ok: true; id: string }>(`/v1/clients/${clientId}/brand`, {
      method: "POST",
      body: JSON.stringify(brand),
    }),

  createGenerationJob: (clientId: string, objective: string, assetIds: string[]) =>
    jsonRequest<{ ok: true; jobId: string; status: string }>("/v1/generation-jobs", {
      method: "POST",
      body: JSON.stringify({ clientId, objective, assetIds }),
    }),

  async getPublicReview(token: string) {
    const result = await jsonRequest<{ data: ApiPost & { client_name?: string } }>(
      `/v1/public/review/${encodeURIComponent(token)}`
    );
    if (result.data.image_url) result.data.image_url = resolveApiUrl(result.data.image_url);
    return result;
  },

  approvePublicReview: (token: string) =>
    jsonRequest<{ ok: true; postId: string; status: string }>(
      `/v1/public/review/${encodeURIComponent(token)}/approve`,
      { method: "POST" }
    ),

  editPublicReview: (
    token: string,
    payload: { headline?: string; caption?: string; comment?: string }
  ) =>
    jsonRequest<{ ok: true; postId: string }>(
      `/v1/public/review/${encodeURIComponent(token)}/edit`,
      { method: "POST", body: JSON.stringify(payload) }
    ),

  rejectPublicReview: (token: string, reason?: string) =>
    jsonRequest<{ ok: true; postId: string; status: string }>(
      `/v1/public/review/${encodeURIComponent(token)}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) }
    ),

  regeneratePublicReview: (token: string, instruction?: string) =>
    jsonRequest<{ ok: true; data: unknown }>(
      `/v1/public/review/${encodeURIComponent(token)}/regenerate`,
      { method: "POST", body: JSON.stringify({ instruction }) }
    ),

  async getClients(includeArchived = false): Promise<Client[]> {
    const result = await jsonRequest<{ data: Client[] }>(
      `/v1/clients${includeArchived ? "?includeArchived=1" : ""}`
    );
    return result.data;
  },

  async getReviewQueue(): Promise<MarketingPost[]> {
    const result = await jsonRequest<{ data: ApiPost[] }>("/v1/posts/review");
    return result.data.map(mapPost);
  },

  async getCalendar(from: string, to: string): Promise<MarketingPost[]> {
    const result = await jsonRequest<{ data: ApiPost[] }>(
      `/v1/posts/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    return result.data.map(mapPost);
  },

  getPostCreative: (postId: string) =>
    jsonRequest<{
      data: {
        variants: Array<{
          id: string;
          variant_key: string;
          aspect_ratio: string;
          width?: number;
          height?: number;
          url?: string;
          is_primary: number;
          composition?: unknown;
        }>;
        score: null | {
          overall: number;
          brand_match: number;
          readability: number;
          platform_fit: number;
          cta_strength: number;
          composition: number;
          caption_quality: number;
          compliance: number;
          rationale?: string;
        };
      };
    }>(`/v1/posts/${postId}/creative`),

  async getPost(postId: string): Promise<MarketingPost> {
    const result = await jsonRequest<{ data: ApiPost }>(`/v1/posts/${postId}`);
    return mapPost(result.data);
  },

  approvePost: (postId: string) =>
    jsonRequest<{ ok: true; status: string }>(`/v1/posts/${postId}/approve`, {
      method: "POST",
    }),

  bulkApprovePosts: (postIds: string[]) =>
    jsonRequest<{ ok: true; results: any[] }>("/v1/posts/bulk/approve", {
      method: "POST",
      body: JSON.stringify({ postIds }),
    }),

  bulkRejectPosts: (postIds: string[], reason?: string) =>
    jsonRequest<{ ok: true; results: any[] }>("/v1/posts/bulk/reject", {
      method: "POST",
      body: JSON.stringify({ postIds, reason }),
    }),

  bulkShiftPosts: (postIds: string[], shiftMinutes: number) =>
    jsonRequest<{ ok: true; results: any[] }>("/v1/posts/bulk/shift", {
      method: "POST",
      body: JSON.stringify({ postIds, shiftMinutes }),
    }),

  bulkPausePosts: (postIds: string[]) =>
    jsonRequest<{ ok: true; results: any[] }>("/v1/posts/bulk/pause", {
      method: "POST",
      body: JSON.stringify({ postIds }),
    }),

  keepSchedule: (postId: string) =>
    jsonRequest<{ ok: true; status: string }>(
      `/v1/posts/${postId}/keep-schedule`,
      { method: "POST" }
    ),

  reschedulePost: (postId: string, scheduledPublishAt: string) =>
    jsonRequest<{
      ok: true;
      status: string;
      scheduledPublishAt: string;
      adjusted: boolean;
    }>(
      `/v1/posts/${postId}/reschedule`,
      {
        method: "POST",
        body: JSON.stringify({ scheduledPublishAt }),
      }
    ),

  publishNow: (postId: string) =>
    jsonRequest<{ ok: true; queued: true }>(
      `/v1/posts/${postId}/publish-now`,
      { method: "POST" }
    ),

  rewritePostCaption: (postId: string, instruction?: string) =>
    jsonRequest<{ ok: true; data: { headline: string; caption: string; hashtags: string[] } }>(
      `/v1/posts/${postId}/ai-rewrite-caption`,
      { method: "POST", body: JSON.stringify({ instruction }) }
    ),

  editPostGraphic: (postId: string, instruction: string) =>
    jsonRequest<{ ok: true; data: { postId: string; imageModel: string; responseId?: string } }>(
      `/v1/posts/${postId}/ai-edit-image`,
      { method: "POST", body: JSON.stringify({ instruction }) }
    ),

  regeneratePost: (postId: string, instruction?: string) =>
    jsonRequest<{ ok: true; data: { postId: string; imageModel: string; responseId?: string } }>(
      `/v1/posts/${postId}/ai-regenerate`,
      { method: "POST", body: JSON.stringify({ instruction }) }
    ),

  async uploadAssetDerivative(
    clientId: string,
    assetId: string,
    uri: string,
    kind = "analysis",
    filename = "analysis.jpg",
    contentType = "image/jpeg",
    width?: number,
    height?: number
  ) {
    const source = await fetch(uri);
    const blob = await source.blob();
    const headers = authHeaders({
      "content-type": blob.type || contentType,
      "x-client-id": clientId,
      "x-file-name": filename,
      "x-derivative-kind": kind,
      ...(width ? { "x-image-width": String(width) } : {}),
      ...(height ? { "x-image-height": String(height) } : {}),
    });

    const response = await fetch(
      `${API_URL}/v1/assets/${encodeURIComponent(assetId)}/derivative`,
      {
        method: "POST",
        headers,
        body: blob,
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        (payload as { error?: string } | null)?.error ??
          `Derivative upload failed: ${response.status}`
      );
    }

    return response.json() as Promise<{ ok: true; id: string }>;
  },

  async uploadAsset(
    clientId: string,
    uri: string,
    filename: string,
    contentType = "image/jpeg",
    width?: number,
    height?: number
  ): Promise<Asset> {
    const source = await fetch(uri);
    const blob = await source.blob();
    const headers = authHeaders({
      "content-type": blob.type || contentType,
      "x-client-id": clientId,
      "x-file-name": filename,
      ...(width ? { "x-image-width": String(width) } : {}),
      ...(height ? { "x-image-height": String(height) } : {}),
    });

    const response = await fetch(`${API_URL}/v1/assets`, {
      method: "POST",
      headers,
      body: blob,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        (payload as { error?: string } | null)?.error ??
          `Upload failed: ${response.status}`
      );
    }

    const result = (await response.json()) as { data: Asset };
    return result.data;
  },
};

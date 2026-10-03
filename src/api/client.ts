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

const REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = authHeaders(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  const method = (init?.method || "GET").toUpperCase();
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_URL}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    if (method !== "GET") throw error;
    response = await fetchWithTimeout(`${API_URL}${path}`, {
      ...init,
      headers,
    });
  }

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
  getDashboard: () =>
    jsonRequest<{ data: {
      awaiting_review: number;
      scheduled: number;
      publishing_today: number;
      failed: number;
      next_post: any | null;
      recent_activity: any[];
      connection_warnings: any[];
    } }>("/v1/dashboard"),

  createClient: (name: string, timezone = "America/Indiana/Indianapolis") =>
    jsonRequest<{ ok: true; data: Client }>("/v1/clients", {
      method: "POST",
      body: JSON.stringify({ name, timezone }),
    }),

  updateClient: (clientId: string, payload: { name?: string; timezone?: string; status?: string }) =>
    jsonRequest<{ ok: true }>(`/v1/clients/${clientId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  archiveClient: (clientId: string) =>
    jsonRequest<{ ok: true }>(`/v1/clients/${clientId}/archive`, { method: "POST" }),

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

  async getClients(): Promise<Client[]> {
    const result = await jsonRequest<{ data: Client[] }>("/v1/clients");
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

  async getPost(postId: string): Promise<MarketingPost> {
    const result = await jsonRequest<{ data: ApiPost }>(`/v1/posts/${postId}`);
    return mapPost(result.data);
  },

  approvePost: (postId: string) =>
    jsonRequest<{ ok: true; status: string }>(`/v1/posts/${postId}/approve`, {
      method: "POST",
    }),

  keepSchedule: (postId: string) =>
    jsonRequest<{ ok: true; status: string }>(
      `/v1/posts/${postId}/keep-schedule`,
      { method: "POST" }
    ),

  reschedulePost: (postId: string, scheduledPublishAt: string) =>
    jsonRequest<{ ok: true; status: string }>(
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

  async uploadAsset(
    clientId: string,
    uri: string,
    filename: string,
    contentType = "image/jpeg"
  ): Promise<Asset> {
    const source = await fetchWithTimeout(uri);
    const blob = await source.blob();
    const headers = authHeaders({
      "content-type": blob.type || contentType,
      "x-client-id": clientId,
      "x-file-name": filename,
    });

    const response = await fetchWithTimeout(`${API_URL}/v1/assets`, {
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

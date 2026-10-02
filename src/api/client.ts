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
  requestAuthCode: (email: string) =>
    jsonRequest<{ ok: true; devCode?: string }>("/v1/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  verifyAuthCode: (email: string, code: string) =>
    jsonRequest<{ token: string; expiresAt: number; user: AuthUser }>(
      "/v1/auth/verify-code",
      {
        method: "POST",
        body: JSON.stringify({ email, code }),
      }
    ),

  getSession: () =>
    jsonRequest<{ user: AuthUser }>("/v1/auth/session"),

  signOut: () =>
    jsonRequest<{ ok: true }>("/v1/auth/logout", { method: "POST" }),

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
    const source = await fetch(uri);
    const blob = await source.blob();
    const headers = authHeaders({
      "content-type": blob.type || contentType,
      "x-client-id": clientId,
      "x-file-name": filename,
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

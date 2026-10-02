import type { Asset, Client, MarketingPost, PrePublishDecision } from "@/types/domain";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8787";

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
    imageUrl: row.image_url ?? undefined,
    suggestedPublishAt: row.suggested_publish_at ?? undefined,
    scheduledPublishAt: row.scheduled_publish_at ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    sparqScore: row.sparq_score ?? undefined,
    prepublishResponse: row.prepublish_response ?? undefined,
  };
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
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

  async uploadAsset(
    clientId: string,
    uri: string,
    filename: string,
    contentType = "image/jpeg"
  ): Promise<Asset> {
    const source = await fetch(uri);
    const blob = await source.blob();
    const response = await fetch(`${API_URL}/v1/assets`, {
      method: "POST",
      headers: {
        "content-type": blob.type || contentType,
        "x-client-id": clientId,
        "x-file-name": filename,
      },
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

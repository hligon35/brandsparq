import * as ImageManipulator from "expo-image-manipulator";
import { imageUploadType } from "@/shared/image-upload";
import type { PilotConfiguration, PilotOverview } from "@/shared/pilot";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { Asset, Client, MarketingPost, PrePublishDecision } from "@/types/domain";

const PRODUCTION_API_URL = "https://brandsparq.getsparqd.com";
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
const isNativeDevice = Platform.OS !== "web" && Constants.isDevice;
const configuredUrlIsLoopback =
  configuredApiUrl != null &&
  /^https?:\/\/(localhost|127(?:\.\d{1,3}){3})(:\d+)?$/i.test(configuredApiUrl);

// A phone's localhost is the phone itself. Use the hosted API on physical devices
// when no URL is configured or the copied example still points to loopback.
// Developers can explicitly use a LAN IP to test a local Worker from a phone.
const API_URL =
  isNativeDevice && (!configuredApiUrl || configuredUrlIsLoopback)
    ? PRODUCTION_API_URL
    : (configuredApiUrl ??
      (Platform.OS === "web" ? "" : __DEV__ ? "http://localhost:8787" : PRODUCTION_API_URL));

let sessionToken: string | null = null;
let unauthorizedHandler: (() => void | Promise<void>) | null = null;

export function setUnauthorizedHandler(handler: (() => void | Promise<void>) | null) {
  unauthorizedHandler = handler;
}

export function setApiSessionToken(token: string | null) {
  sessionToken = token;
}

type AuthUser = {
  id: string;
  email: string;
  name?: string;
  role: string;
  clientRoles?: Record<string, string>;
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
  headline?: string | null;
  caption: string;
  image_url?: string | null;
  suggested_publish_at?: string | null;
  scheduled_publish_at?: string | null;
  approved_at?: string | null;
  sparq_score?: number | null;
  prepublish_response?: PrePublishDecision | null;
  social_account_id?: string | null;
  social_account_name?: string | null;
  publish_block_reason?: string;
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
    publishBlockReason: row.publish_block_reason,
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
    if (response.status === 401 && unauthorizedHandler) {
      await unauthorizedHandler();
    }
    const payload = await response.json().catch(() => null);
    throw Object.assign(
      new Error(
        (payload as { error?: string } | null)?.error ?? `Request failed: ${response.status}`,
      ),
      { status: response.status },
    );
  }

  return response.json() as Promise<T>;
}

export const api = {
  getProfile: () =>
    jsonRequest<{
      data: { id: string; name: string; email: string; role: string; avatar_url: string | null };
    }>("/v1/profile"),
  saveProfile: (name: string, avatar?: string | null) =>
    jsonRequest<{ data: unknown }>("/v1/profile", {
      method: "PATCH",
      body: JSON.stringify({ name, ...(avatar !== undefined ? { avatar } : {}) }),
    }),
  requestProfileEmail: (email: string) =>
    jsonRequest<{ ok: true }>("/v1/profile/email/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  verifyProfileEmail: (code: string) =>
    jsonRequest<{ data: unknown }>("/v1/profile/email/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  deleteAccount: () =>
    jsonRequest<{ ok: true }>("/v1/profile", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE" }),
    }),

  getGenerationJobs: (options: { cursor?: string; search?: string; status?: string } = {}) =>
    jsonRequest<{ data: any[]; nextCursor: string | null }>(
      `/v1/generation-jobs?${new URLSearchParams(options).toString()}`,
    ),
  getGenerationJob: (id: string) => jsonRequest<{ data: any }>(`/v1/generation-jobs/${id}`),
  generationAction: (id: string, action: "retry" | "cancel") =>
    jsonRequest<{ ok: true }>(`/v1/generation-jobs/${id}/${action}`, { method: "POST" }),
  restoreClient: (id: string) =>
    jsonRequest<{ ok: true }>(`/v1/clients/${id}/restore`, { method: "POST" }),
  getPausedPosts: () => jsonRequest<{ data: any[] }>("/v1/posts/paused"),
  pausedAction: (id: string, action: "resume" | "restore-review" | "cancel") =>
    jsonRequest<{ ok: true }>(`/v1/posts/${id}/${action}`, { method: "POST" }),
  removeBrandAsset: (clientId: string, id: string) =>
    jsonRequest<{ ok: true }>(`/v1/clients/${clientId}/brand-assets/${id}/remove`, {
      method: "POST",
    }),
  getReviewers: (clientId: string) =>
    jsonRequest<{ data: any[] }>(`/v1/clients/${clientId}/reviewers`),
  saveReviewer: (clientId: string, email: string, enabled = true) =>
    jsonRequest<{ ok: true }>(`/v1/clients/${clientId}/reviewers`, {
      method: "POST",
      body: JSON.stringify({ email, enabled }),
    }),
  getReviewLinks: (clientId: string) =>
    jsonRequest<{ data: { tokens: any[]; deliveries: any[] } }>(
      `/v1/clients/${clientId}/review-links`,
    ),
  reviewLinksAction: (clientId: string, payload: Record<string, unknown> = {}) =>
    jsonRequest<{ ok: true; data?: { sent: number; failed: number } }>(
      `/v1/clients/${clientId}/review-links`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  getInvitations: () => jsonRequest<{ data: any[] }>("/v1/team/invitations"),
  invite: (payload: Record<string, unknown>) =>
    jsonRequest<{ ok: true; deliveryStatus: string; error?: string }>("/v1/team/invitations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  invitationAction: (id: string, action: "resend" | "revoke") =>
    jsonRequest<{ ok: true }>(`/v1/team/invitations/${id}/${action}`, { method: "POST" }),
  memberAction: (id: string, action: "status" | "revoke-sessions", status?: string) =>
    jsonRequest<{ ok: true }>(`/v1/team/users/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  getInvitation: (token: string) =>
    jsonRequest<{ data: { email: string; expiresAt: number } }>(`/v1/public/invitations/${token}`),
  unregisterPushToken: (token: string) =>
    jsonRequest<{ ok: true }>("/v1/push-token/unregister", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

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

  getSession: () => jsonRequest<{ user: AuthUser }>("/v1/auth/session"),

  signOut: () => jsonRequest<{ ok: true }>("/v1/auth/logout", { method: "POST" }),

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
    jsonRequest<{ ok: true; id: string; name: string; timezone: string }>("/v1/clients", {
      method: "POST",
      body: JSON.stringify({ name, timezone }),
    }),

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

  attachBrandAsset: (clientId: string, assetId: string, role: string, label?: string) =>
    jsonRequest<{ ok: true; id: string }>(`/v1/clients/${clientId}/brand-assets`, {
      method: "POST",
      body: JSON.stringify({ assetId, role, label }),
    }),

  getCampaigns: (clientId?: string) =>
    jsonRequest<{ data: any[] }>(
      `/v1/campaigns${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`,
    ),

  getCampaign: (campaignId: string) =>
    jsonRequest<{ data: { campaign: any; posts: any[] } }>(`/v1/campaigns/${campaignId}`),

  updateCampaign: (campaignId: string, payload: Record<string, unknown>) =>
    jsonRequest<{ ok: true }>(`/v1/campaigns/${campaignId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getSocialAccounts: (clientId?: string) =>
    jsonRequest<{ data: any[] }>(
      `/v1/social/accounts${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`,
    ),

  startSocialConnection: (platform: string, clientId: string, returnTo: string) =>
    jsonRequest<{ authorizationUrl: string }>("/v1/social/connect", {
      method: "POST",
      body: JSON.stringify({ platform, clientId, returnTo }),
    }),

  disconnectSocialAccount: (accountId: string) =>
    jsonRequest<{ ok: true }>(`/v1/social/accounts/${accountId}/disconnect`, {
      method: "POST",
    }),

  verifySocialAccount: (accountId: string) =>
    jsonRequest<{ ok: true; data: { health: string; checkedAt: string } }>(
      `/v1/social/accounts/${accountId}/verify`,
      { method: "POST" },
    ),

  assignSocialAccount: (postId: string, socialAccountId: string) =>
    jsonRequest<{ ok: true }>(`/v1/posts/${postId}/social-account`, {
      method: "POST",
      body: JSON.stringify({ socialAccountId }),
    }),

  getNotifications: (
    options: { cursor?: string; search?: string; filter?: string; limit?: string } = {},
  ) =>
    jsonRequest<{ data: any[]; unreadCount: number; nextCursor: string | null }>(
      `/v1/notifications?${new URLSearchParams(options).toString()}`,
    ),

  deleteNotifications: (ids: string[]) =>
    jsonRequest<{ ok: true }>("/v1/notifications/delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  markNotificationRead: (notificationId: string) =>
    jsonRequest<{ ok: true }>(`/v1/notifications/${notificationId}/read`, {
      method: "POST",
    }),

  markAllNotificationsRead: () =>
    jsonRequest<{ ok: true }>("/v1/notifications/read-all", {
      method: "POST",
    }),

  registerPushToken: (token: string, platform?: string, deviceName?: string) =>
    jsonRequest<{ ok: true }>("/v1/push-token", {
      method: "POST",
      body: JSON.stringify({ token, platform, deviceName }),
    }),

  getSettings: () => jsonRequest<{ data: any }>("/v1/settings"),

  saveSettings: (payload: Record<string, unknown>) =>
    jsonRequest<{ ok: true }>("/v1/settings", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  testNotifications: () => jsonRequest<{ ok: true }>("/v1/notifications/test", { method: "POST" }),

  getSystemOverview: () => jsonRequest<{ data: any }>("/v1/system/overview"),

  getPilot: () => jsonRequest<{ data: PilotOverview }>("/v1/system/pilot"),
  configurePilot: (payload: PilotConfiguration) =>
    jsonRequest<{ ok: true; data: PilotOverview }>("/v1/system/pilot", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  recoverSystemWork: () =>
    jsonRequest<{ ok: true; data: any }>("/v1/system/recover", { method: "POST" }),

  retryFailedPost: (postId: string) =>
    jsonRequest<{ ok: true; publishJobId: string }>(`/v1/system/posts/${postId}/retry`, {
      method: "POST",
    }),

  reconcilePublish: (
    postId: string,
    payload: {
      publishVersion: number;
      outcome: "published" | "absent";
      providerPostId?: string;
      evidence: string;
    },
  ) =>
    jsonRequest<{ ok: true }>(`/v1/system/posts/${postId}/reconcile`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  resolveSystemEvent: (eventId: string) =>
    jsonRequest<{ ok: true }>(`/v1/system/events/${eventId}/resolve`, {
      method: "POST",
    }),

  runLaunchCertification: () =>
    jsonRequest<{
      data: {
        id: string;
        status: "ready" | "ready_with_warnings" | "blocked";
        blockers: string[];
        warnings: string[];
        checks: Array<{ name: string; ok: boolean; level: string; detail: string }>;
        createdAt: string;
      };
    }>("/v1/system/certify", { method: "POST" }),

  getLaunchCertifications: () => jsonRequest<{ data: any[] }>("/v1/system/certifications"),

  getAccessManagement: () =>
    jsonRequest<{ data: { users: any[]; clients: any[]; access: any[] } }>("/v1/system/access"),

  updateUserRole: (userId: string, role: string) =>
    jsonRequest<{ ok: true }>(`/v1/system/users/${userId}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    }),

  updateUserClientAccess: (
    userId: string,
    clientId: string,
    enabled: boolean,
    accessRole?: string,
  ) =>
    jsonRequest<{ ok: true }>(`/v1/system/users/${userId}/clients/${clientId}`, {
      method: "POST",
      body: JSON.stringify({ enabled, accessRole }),
    }),

  getAnalyticsOverview: (clientId?: string, days = 30) => {
    const params = new URLSearchParams();
    if (clientId) params.set("clientId", clientId);
    params.set("days", String(days));
    return jsonRequest<{ data: any }>(`/v1/analytics/overview?${params.toString()}`);
  },

  syncAnalytics: (accountId?: string) =>
    jsonRequest<{
      ok: boolean;
      results: Array<{ accountId: string; ok: boolean; status?: string; error?: string }>;
    }>("/v1/analytics/sync", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    }),

  validateSchedule: (clientId: string, scheduledAt: string) =>
    jsonRequest<{ data: { requested: string; suggested: string; conflict: boolean } }>(
      `/v1/clients/${clientId}/schedule/validate`,
      { method: "POST", body: JSON.stringify({ scheduledAt }) },
    ),

  recommendSchedule: (clientId: string, desiredAt?: string) =>
    jsonRequest<{ data: { scheduledAt: string } }>(`/v1/clients/${clientId}/schedule/recommend`, {
      method: "POST",
      body: JSON.stringify({ desiredAt }),
    }),

  getBrand: (clientId: string) => jsonRequest<{ data: any }>(`/v1/clients/${clientId}/brand`),

  saveBrand: (clientId: string, brand: Record<string, unknown>) =>
    jsonRequest<{ ok: true; id: string }>(`/v1/clients/${clientId}/brand`, {
      method: "POST",
      body: JSON.stringify(brand),
    }),

  getCreationReadiness: (clientId: string) =>
    jsonRequest<{ data: any }>(`/v1/clients/${clientId}/creation-readiness`),
  createContent: (payload: {
    clientId: string;
    objective: string;
    assetIds: string[];
    requestKey: string;
    mode: "social" | "campaign";
    outputCount: number;
    destinationIds: string[];
  }) =>
    jsonRequest<{ ok: true; jobId: string; status: string }>("/v1/creation-jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  setDefaultSocialAccount: (id: string) =>
    jsonRequest<{ ok: true }>(`/v1/social/accounts/${id}/default`, { method: "POST" }),
  campaignPostAction: (id: string, action: "pause" | "resume" | "cancel" | "approve") =>
    jsonRequest<{ ok: true; results: { postId: string; ok: boolean; error?: string }[] }>(
      `/v1/campaigns/${id}/posts/${action}`,
      { method: "POST" },
    ),

  createGenerationJob: (
    clientId: string,
    objective: string,
    assetIds: string[],
    requestKey: string,
  ) =>
    jsonRequest<{ ok: true; jobId: string; status: string }>("/v1/generation-jobs", {
      method: "POST",
      body: JSON.stringify({ clientId, objective, assetIds, requestKey }),
    }),

  async getPublicReview(token: string) {
    const result = await jsonRequest<{ data: ApiPost & { client_name?: string } }>(
      `/v1/public/review/${encodeURIComponent(token)}`,
    );
    if (result.data.image_url) result.data.image_url = resolveApiUrl(result.data.image_url);
    return result;
  },

  approvePublicReview: (token: string) =>
    jsonRequest<{ ok: true; postId: string; status: string }>(
      `/v1/public/review/${encodeURIComponent(token)}/approve`,
      { method: "POST" },
    ),

  editPublicReview: (
    token: string,
    payload: { headline?: string; caption?: string; comment?: string },
  ) =>
    jsonRequest<{ ok: true; postId: string }>(
      `/v1/public/review/${encodeURIComponent(token)}/edit`,
      { method: "POST", body: JSON.stringify(payload) },
    ),

  rejectPublicReview: (token: string, reason?: string) =>
    jsonRequest<{ ok: true; postId: string; status: string }>(
      `/v1/public/review/${encodeURIComponent(token)}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),

  regeneratePublicReview: (token: string, instruction?: string) =>
    jsonRequest<{ ok: true; data: unknown }>(
      `/v1/public/review/${encodeURIComponent(token)}/regenerate`,
      { method: "POST", body: JSON.stringify({ instruction }) },
    ),

  async getClients(includeArchived = false): Promise<Client[]> {
    const result = await jsonRequest<{ data: Client[] }>(
      `/v1/clients${includeArchived ? "?includeArchived=1" : ""}`,
    );
    return result.data;
  },

  async getReviewQueue(): Promise<MarketingPost[]> {
    const result = await jsonRequest<{ data: ApiPost[] }>("/v1/posts/review");
    return result.data.map(mapPost);
  },

  async getCalendar(from: string, to: string): Promise<MarketingPost[]> {
    const result = await jsonRequest<{ data: ApiPost[] }>(
      `/v1/posts/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
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

  editPost: (postId: string, payload: { headline?: string; caption?: string; comment?: string }) =>
    jsonRequest<{ ok: true }>(`/v1/posts/${postId}/edit`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  rejectPost: (postId: string, reason?: string) =>
    jsonRequest<{ ok: true; status: string }>(`/v1/posts/${postId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
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
    jsonRequest<{ ok: true; status: string }>(`/v1/posts/${postId}/keep-schedule`, {
      method: "POST",
    }),

  reschedulePost: (postId: string, scheduledPublishAt: string) =>
    jsonRequest<{
      ok: true;
      status: string;
      scheduledPublishAt: string;
      adjusted: boolean;
    }>(`/v1/posts/${postId}/reschedule`, {
      method: "POST",
      body: JSON.stringify({ scheduledPublishAt }),
    }),

  publishNow: (postId: string) =>
    jsonRequest<{ ok: true; queued: true }>(`/v1/posts/${postId}/publish-now`, { method: "POST" }),

  rewritePostCaption: (postId: string, instruction?: string) =>
    jsonRequest<{ ok: true; data: { headline: string; caption: string; hashtags: string[] } }>(
      `/v1/posts/${postId}/ai-rewrite-caption`,
      { method: "POST", body: JSON.stringify({ instruction }) },
    ),

  editPostGraphic: (postId: string, instruction: string) =>
    jsonRequest<{ ok: true; data: { postId: string; imageModel: string; responseId?: string } }>(
      `/v1/posts/${postId}/ai-edit-image`,
      { method: "POST", body: JSON.stringify({ instruction }) },
    ),

  regeneratePost: (postId: string, instruction?: string) =>
    jsonRequest<{ ok: true; data: { postId: string; imageModel: string; responseId?: string } }>(
      `/v1/posts/${postId}/ai-regenerate`,
      { method: "POST", body: JSON.stringify({ instruction }) },
    ),

  async uploadAssetDerivative(
    clientId: string,
    assetId: string,
    uri: string,
    kind = "analysis",
    filename = "analysis.jpg",
    contentType = "image/jpeg",
    width?: number,
    height?: number,
  ) {
    const source = await fetchWithTimeout(uri);
    const blob = await source.blob();
    const headers = authHeaders({
      "content-type": imageUploadType(blob.type, contentType),
      "x-client-id": clientId,
      "x-file-name": filename,
      "x-derivative-kind": kind,
      ...(width ? { "x-image-width": String(width) } : {}),
      ...(height ? { "x-image-height": String(height) } : {}),
    });

    const response = await fetch(`${API_URL}/v1/assets/${encodeURIComponent(assetId)}/derivative`, {
      method: "POST",
      headers,
      body: blob,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        (payload as { error?: string } | null)?.error ??
          `Derivative upload failed: ${response.status}`,
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
    height?: number,
  ): Promise<Asset> {
    if (/hei[cf]/i.test(contentType + filename)) {
      const converted = await ImageManipulator.manipulateAsync(uri, [], {
        format: ImageManipulator.SaveFormat.JPEG,
        compress: 0.92,
      });
      uri = converted.uri;
      contentType = "image/jpeg";
      filename = filename.replace(/\.[^.]+$/, "") + ".jpg";
    }
    const source = await fetchWithTimeout(uri);
    const blob = await source.blob();
    const headers = authHeaders({
      "content-type": imageUploadType(blob.type, contentType),
      "x-client-id": clientId,
      "x-file-name": filename,
      ...(width ? { "x-image-width": String(width) } : {}),
      ...(height ? { "x-image-height": String(height) } : {}),
    });

    const response = await fetchWithTimeout(`${API_URL}/v1/assets`, {
      method: "POST",
      headers,
      body: blob,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        (payload as { error?: string } | null)?.error ?? `Upload failed: ${response.status}`,
      );
    }

    const result = (await response.json()) as { data: Asset };
    return result.data;
  },
};

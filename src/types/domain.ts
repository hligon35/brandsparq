export type PostStatus =
  | "draft"
  | "review_ready"
  | "awaiting_approval"
  | "approved"
  | "calendar_scheduled"
  | "pre_publish"
  | "publishing"
  | "published"
  | "edit_requested"
  | "regenerating"
  | "rescheduled"
  | "paused"
  | "failed"
  | "canceled";

export type Platform = "instagram" | "facebook" | "linkedin" | "tiktok" | "x";
export type PrePublishDecision = "keep" | "reschedule" | "publish_now";

export interface Client {
  id: string;
  name: string;
  color: string;
  timezone?: string;
}

export interface BrandProfile {
  id: string;
  clientId: string;
  voice?: string;
  audience?: string;
  primaryColor?: string;
  secondaryColor?: string;
  website?: string;
}

export interface Asset {
  id: string;
  clientId: string;
  filename: string;
  contentType: string;
  url: string;
  status: "uploaded" | "analyzing" | "ready" | "failed";
  createdAt?: string;
}

export interface MarketingPost {
  id: string;
  clientId: string;
  clientName?: string;
  clientColor?: string;
  campaignId?: string;
  platform: Platform;
  status: PostStatus;
  title: string;
  caption: string;
  imageUrl?: string;
  suggestedPublishAt?: string;
  scheduledPublishAt?: string;
  approvedAt?: string;
  sparqScore?: number;
  prepublishResponse?: PrePublishDecision;
}

export interface NotificationItem {
  id: string;
  postId?: string;
  type: string;
  channel: "in_app" | "email" | "push";
  status: "queued" | "sent" | "failed" | "read";
  scheduledFor?: string;
  createdAt: string;
}

export type PostStatus="draft"|"review_ready"|"awaiting_approval"|"approved"|"calendar_scheduled"|"pre_publish"|"publishing"|"published"|"edit_requested"|"regenerating"|"rescheduled"|"paused"|"failed"|"canceled";
export type Platform="instagram"|"facebook"|"linkedin"|"tiktok"|"x";
export interface Client{id:string;name:string;color:string;}
export interface MarketingPost{id:string;clientId:string;campaignId?:string;platform:Platform;status:PostStatus;title:string;caption:string;imageUrl?:string;suggestedPublishAt?:string;scheduledPublishAt?:string;approvedAt?:string;sparqScore?:number;}
export type PrePublishDecision="keep"|"reschedule"|"publish_now";

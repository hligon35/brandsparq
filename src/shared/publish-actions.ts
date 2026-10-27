export function publishActions(post: {
  status: string;
  approvedAt?: string;
  scheduledPublishAt?: string;
  socialAccountId?: string;
  publishBlockReason?: string;
}) {
  const scheduled = ["calendar_scheduled", "pre_publish", "rescheduled"].includes(post.status);
  const approved = !!post.approvedAt;
  return {
    keep: scheduled && approved && !!post.scheduledPublishAt,
    reschedule: (scheduled || post.status === "paused") && approved,
    publish:
      (scheduled || post.status === "paused") &&
      approved &&
      !!post.socialAccountId &&
      !post.publishBlockReason,
    resume: post.status === "paused" && approved,
    message:
      post.publishBlockReason ||
      (post.status === "published"
        ? "This post is already published."
        : post.status === "provider_processing"
          ? "The provider is still processing this post. A second submission is blocked."
          : ["publishing", "publish_queued"].includes(post.status)
            ? "Publishing is already underway. Follow the post status before taking another action."
            : post.status === "failed"
              ? "This post needs recovery. Open System Health to review the failure and any unknown provider outcome."
              : !approved
                ? "Review and approve this post before scheduling or publishing."
                : !post.socialAccountId
                  ? "Choose a connected publishing destination before publishing."
                  : post.status === "paused"
                    ? "This post is paused. Resume, reschedule, or explicitly publish it when ready."
                    : "Choose how to handle this approved post."),
  };
}

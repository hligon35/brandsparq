export function notificationRoute(item: {
  post_id?: string;
  type?: string;
  deep_link?: string;
}): string | null {
  if (item.post_id && /^[a-zA-Z0-9-]{1,128}$/.test(item.post_id))
    return `/posts/${item.post_id}${item.type === "pre_publish" ? "/publish" : ""}`;
  let path = item.deep_link || "";
  if (!path.startsWith("/") || path.startsWith("//")) {
    try {
      const url = new URL(path);
      if (["brandsparq:", "brandsparq-staging:"].includes(url.protocol))
        path = "/" + url.hostname + url.pathname;
      else if (
        url.protocol === "https:" &&
        (url.hostname === "brandsparq.getsparqd.com" ||
          /^brandsparq-staging\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname))
      )
        path = url.pathname;
      else return null;
    } catch {
      return null;
    }
  }
  return /^\/(?:posts\/[a-zA-Z0-9-]+(?:\/(?:publish|reschedule))?|campaigns(?:\/[a-zA-Z0-9-]+)?|clients(?:\/[a-zA-Z0-9-]+(?:\/brand)?)?|calendar|review|generation|analytics|social|notifications|settings|paused)$/.test(
    path,
  )
    ? path
    : null;
}

/** Pushes must belong to the current user and may only open allowlisted internal routes. */
export function pushNotificationTarget(data: Record<string, unknown>, userId: string) {
  if (data.userId !== userId) return null;
  const validId = (value: unknown): value is string =>
    typeof value === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(value);
  if (data.postId !== undefined && !validId(data.postId)) return null;
  const notificationId = validId(data.notificationId) ? data.notificationId : null;
  const path = notificationRoute({
    post_id: validId(data.postId) ? data.postId : undefined,
    type: typeof data.type === "string" ? data.type : undefined,
    deep_link: typeof data.deepLink === "string" ? data.deepLink : undefined,
  });
  if (!path && !notificationId) return null;
  return { path: path || "/notifications", notificationId };
}

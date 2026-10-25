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

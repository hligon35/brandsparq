// Only return a display URL, never provider credentials or token-bearing URLs.
export function socialProfileImage(value: unknown): string | null {
  let data: any = value;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const candidate =
    data?.profileImageUrl ||
    data?.profile_picture_url ||
    data?.profile_image_url ||
    data?.avatar_url ||
    data?.avatar ||
    (typeof data?.picture === "string" ? data.picture : data?.picture?.data?.url);
  if (typeof candidate !== "string") return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (
      [...url.searchParams.keys()].some((key) =>
        /^(access_token|token|client_secret|appsecret_proof)$/i.test(key),
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export class ArtworkNotReady extends Error {
  constructor() {
    super(
      "Final artwork is missing. Complete or replace the graphic before approving or publishing this post.",
    );
  }
}
export async function requireArtwork(
  env: { DB: D1Database; MEDIA?: { head(key: string): Promise<unknown> } },
  postId: string,
) {
  const row = await env.DB.prepare("SELECT graphic_key FROM posts WHERE id=?")
    .bind(postId)
    .first<{ graphic_key: string | null }>();
  if (!row?.graphic_key || !env.MEDIA || !(await env.MEDIA.head(row.graphic_key)))
    throw new ArtworkNotReady();
  return row.graphic_key;
}

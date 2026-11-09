/** Source previews remain separate from final artwork and always match the post's client. */
export async function sourcePreviewKey(env: { DB: D1Database }, postId: string, clientId: string) {
  const source = await env.DB.prepare(`SELECT a.r2_key FROM post_assets pa
    JOIN assets a ON a.id=pa.asset_id AND a.client_id=?
    WHERE pa.post_id=? AND pa.role='source' AND a.content_type LIKE 'image/%'
    ORDER BY a.created_at ASC,a.id ASC LIMIT 1`)
    .bind(clientId, postId)
    .first<{ r2_key: string }>();
  return source?.r2_key || null;
}

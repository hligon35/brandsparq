// SQLite rowid orders samples with identical provider capture timestamps.
// Always select one complete sample; never add multiple snapshots of the same post.
export const latestMetricsJoin = `LEFT JOIN post_metrics pm ON pm.rowid=(
  SELECT m.rowid FROM post_metrics m WHERE m.post_id=p.id AND (m.impressions IS NOT NULL OR m.reach IS NOT NULL OR m.likes IS NOT NULL OR m.comments IS NOT NULL OR m.shares IS NOT NULL OR m.clicks IS NOT NULL OR m.saves IS NOT NULL)
  ORDER BY datetime(m.measured_at) DESC,m.rowid DESC LIMIT 1
)`;

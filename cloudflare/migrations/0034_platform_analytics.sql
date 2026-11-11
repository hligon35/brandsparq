-- Provider-owned reporting data is isolated from the publishing/review pipeline.
ALTER TABLE analytics_jobs ADD COLUMN scope TEXT NOT NULL DEFAULT 'brandsparq';
ALTER TABLE analytics_jobs ADD COLUMN platform_cursor TEXT;
ALTER TABLE analytics_jobs ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_jobs ADD COLUMN account_revision INTEGER;
ALTER TABLE analytics_jobs ADD COLUMN warnings_json TEXT NOT NULL DEFAULT '[]';
CREATE TABLE platform_account_insights (
 social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
 range_days INTEGER NOT NULL, range_start TEXT NOT NULL, range_end TEXT NOT NULL,
 connection_revision INTEGER NOT NULL, complete INTEGER NOT NULL DEFAULT 0, metrics_json TEXT NOT NULL, daily_json TEXT NOT NULL,
 measured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(social_account_id,range_days)
);
CREATE TABLE platform_content (
 social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
 external_id TEXT NOT NULL, connection_revision INTEGER NOT NULL,
 published_at TEXT NOT NULL, title TEXT NOT NULL, platform_url TEXT, metrics_json TEXT NOT NULL,
 insights_complete INTEGER NOT NULL DEFAULT 0, seen_job_id TEXT,
 measured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(social_account_id,external_id)
);
CREATE INDEX platform_content_range ON platform_content(social_account_id,published_at);

PRAGMA foreign_keys = ON;

ALTER TABLE notifications ADD COLUMN title TEXT;
ALTER TABLE notifications ADD COLUMN body TEXT;
ALTER TABLE notifications ADD COLUMN deep_link TEXT;
ALTER TABLE notifications ADD COLUMN read_at TEXT;

CREATE TABLE client_settings (
  client_id TEXT PRIMARY KEY,
  prepublish_minutes INTEGER,
  no_response_policy TEXT,
  min_post_spacing_minutes INTEGER,
  max_posts_per_day INTEGER,
  preferred_windows TEXT,
  blackout_windows TEXT,
  allowed_weekdays TEXT,
  default_platforms TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE social_publish_receipts (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  social_account_id TEXT NOT NULL,
  provider_request_id TEXT,
  provider_post_id TEXT,
  provider_post_url TEXT,
  status TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id)
);

CREATE INDEX idx_social_publish_receipts_post
  ON social_publish_receipts(post_id, created_at);

CREATE INDEX idx_notifications_user_status
  ON notifications(user_id, status, created_at);

CREATE INDEX idx_post_metrics_latest
  ON post_metrics(post_id, measured_at DESC);

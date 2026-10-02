PRAGMA foreign_keys = ON;

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  campaign_id TEXT,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  graphic_key TEXT,
  suggested_publish_at TEXT,
  scheduled_publish_at TEXT,
  review_requested_at TEXT,
  approved_at TEXT,
  approved_by TEXT,
  prepublish_alert_at TEXT,
  prepublish_response TEXT,
  published_at TEXT,
  platform_post_id TEXT,
  platform_url TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE INDEX idx_posts_schedule ON posts(status, scheduled_publish_at);
CREATE INDEX idx_posts_client ON posts(client_id, status);

CREATE TABLE publish_attempts (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  provider_response TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  post_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

PRAGMA foreign_keys = ON;

ALTER TABLE social_accounts ADD COLUMN access_token_ciphertext TEXT;
ALTER TABLE social_accounts ADD COLUMN refresh_token_ciphertext TEXT;
ALTER TABLE social_accounts ADD COLUMN token_expires_at INTEGER;
ALTER TABLE social_accounts ADD COLUMN scopes TEXT;
ALTER TABLE social_accounts ADD COLUMN metadata TEXT;
ALTER TABLE social_accounts ADD COLUMN account_type TEXT;
ALTER TABLE social_accounts ADD COLUMN default_visibility TEXT;
ALTER TABLE social_accounts ADD COLUMN last_error TEXT;
ALTER TABLE social_accounts ADD COLUMN connected_by TEXT;

ALTER TABLE posts ADD COLUMN social_account_id TEXT;
ALTER TABLE posts ADD COLUMN publish_started_at TEXT;
ALTER TABLE posts ADD COLUMN publish_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN last_publish_attempt_at TEXT;

ALTER TABLE campaigns ADD COLUMN priority INTEGER NOT NULL DEFAULT 50;
ALTER TABLE campaigns ADD COLUMN notes TEXT;

CREATE TABLE social_oauth_states (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  client_id TEXT NOT NULL,
  user_id TEXT,
  state_hash TEXT NOT NULL UNIQUE,
  code_verifier TEXT,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_social_oauth_state
  ON social_oauth_states(state_hash, expires_at);

CREATE TABLE publish_media_tokens (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE INDEX idx_publish_media_tokens
  ON publish_media_tokens(token_hash, expires_at);

CREATE TABLE device_push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform TEXT,
  device_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_device_push_user
  ON device_push_tokens(user_id, enabled);

CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  push_enabled INTEGER NOT NULL DEFAULT 1,
  in_app_enabled INTEGER NOT NULL DEFAULT 1,
  review_email_enabled INTEGER NOT NULL DEFAULT 1,
  prepublish_minutes INTEGER NOT NULL DEFAULT 30,
  no_response_policy TEXT NOT NULL DEFAULT 'auto_publish',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE workspace_settings (
  id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'America/Indiana/Indianapolis',
  default_prepublish_minutes INTEGER NOT NULL DEFAULT 30,
  default_no_response_policy TEXT NOT NULL DEFAULT 'auto_publish',
  min_post_spacing_minutes INTEGER NOT NULL DEFAULT 180,
  max_posts_per_day INTEGER NOT NULL DEFAULT 3,
  preferred_windows TEXT NOT NULL DEFAULT '["09:00-11:00","17:00-20:00"]',
  blackout_windows TEXT NOT NULL DEFAULT '[]',
  analytics_refresh_hours INTEGER NOT NULL DEFAULT 6,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO workspace_settings (id) VALUES ('default');

CREATE TABLE post_metrics (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  impressions INTEGER,
  reach INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  clicks INTEGER,
  saves INTEGER,
  raw_json TEXT,
  measured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE INDEX idx_post_metrics_post
  ON post_metrics(post_id, measured_at);

CREATE TABLE analytics_sync_runs (
  id TEXT PRIMARY KEY,
  social_account_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  error_message TEXT,
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id)
);

CREATE INDEX idx_analytics_sync_account
  ON analytics_sync_runs(social_account_id, started_at);

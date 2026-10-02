PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE brand_profiles (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  voice TEXT,
  audience TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  website TEXT,
  social_handles TEXT,
  restricted_words TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  objective TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  source TEXT NOT NULL DEFAULT 'upload',
  status TEXT NOT NULL DEFAULT 'uploaded',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE post_assets (
  post_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'source',
  PRIMARY KEY (post_id, asset_id),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT,
  decision TEXT NOT NULL,
  previous_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE social_accounts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_name TEXT,
  external_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  post_id TEXT,
  type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  status TEXT NOT NULL DEFAULT 'queued',
  scheduled_for TEXT,
  sent_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

ALTER TABLE posts ADD COLUMN sparq_score INTEGER;
ALTER TABLE posts ADD COLUMN calendar_added_at TEXT;

CREATE INDEX idx_assets_client ON assets(client_id, created_at);
CREATE INDEX idx_campaigns_client ON campaigns(client_id, status);
CREATE INDEX idx_notifications_status ON notifications(status, scheduled_for);

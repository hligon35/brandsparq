PRAGMA foreign_keys = ON;

CREATE TABLE auth_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_auth_codes_email ON auth_codes(email, created_at);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_sessions_token ON sessions(token_hash, expires_at);

CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  requested_by TEXT,
  objective TEXT NOT NULL DEFAULT 'Auto',
  asset_ids TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider TEXT,
  model TEXT,
  campaign_id TEXT,
  result_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX idx_generation_jobs_client ON generation_jobs(client_id, created_at);

CREATE TABLE review_tokens (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  recipient_email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE INDEX idx_review_tokens_post ON review_tokens(post_id, expires_at);

ALTER TABLE brand_profiles ADD COLUMN tagline TEXT;
ALTER TABLE brand_profiles ADD COLUMN preferred_ctas TEXT;
ALTER TABLE brand_profiles ADD COLUMN imagery_preferences TEXT;
ALTER TABLE brand_profiles ADD COLUMN posting_rules TEXT;

ALTER TABLE posts ADD COLUMN generation_job_id TEXT;
ALTER TABLE posts ADD COLUMN headline TEXT;
ALTER TABLE posts ADD COLUMN hashtags TEXT;
ALTER TABLE posts ADD COLUMN objective TEXT;

CREATE INDEX idx_posts_generation_job ON posts(generation_job_id);

PRAGMA foreign_keys = ON;

CREATE TABLE publish_jobs (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  execution_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  scheduled_for TEXT,
  last_error TEXT,
  queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE INDEX idx_publish_jobs_status
  ON publish_jobs(status, scheduled_for);

CREATE INDEX idx_publish_jobs_post
  ON publish_jobs(post_id, created_at);

ALTER TABLE publish_attempts ADD COLUMN publish_job_id TEXT;
CREATE INDEX idx_publish_attempts_job
  ON publish_attempts(publish_job_id, created_at);

ALTER TABLE generation_jobs ADD COLUMN stage TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE generation_jobs ADD COLUMN plan_json TEXT;
ALTER TABLE generation_jobs ADD COLUMN post_ids TEXT;
ALTER TABLE generation_jobs ADD COLUMN review_email_sent_at TEXT;
ALTER TABLE generation_jobs ADD COLUMN stage_updated_at TEXT;

CREATE TABLE media_access_tokens (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_media_access_tokens_hash
  ON media_access_tokens(token_hash, expires_at);

CREATE TABLE user_client_access (
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  access_role TEXT NOT NULL DEFAULT 'reviewer',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, client_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE INDEX idx_user_client_access_client
  ON user_client_access(client_id, user_id);

ALTER TABLE social_accounts ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_social_accounts_default
  ON social_accounts(client_id, platform, is_default, status);

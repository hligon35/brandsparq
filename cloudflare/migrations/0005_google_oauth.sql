PRAGMA foreign_keys = ON;

CREATE TABLE google_oauth_states (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_google_oauth_states_hash
  ON google_oauth_states(state_hash, expires_at);

CREATE TABLE google_auth_handoffs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  handoff_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_google_auth_handoffs_hash
  ON google_auth_handoffs(handoff_hash, expires_at);

ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

CREATE INDEX idx_users_google_sub ON users(google_sub);

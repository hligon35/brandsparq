PRAGMA foreign_keys = ON;

CREATE TABLE system_events (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  message TEXT NOT NULL,
  metadata_json TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_system_events_active
  ON system_events(resolved_at, severity, created_at DESC);

CREATE INDEX idx_system_events_entity
  ON system_events(entity_type, entity_id, created_at DESC);

CREATE TABLE recovery_actions (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  previous_state TEXT,
  next_state TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX idx_recovery_actions_entity
  ON recovery_actions(entity_type, entity_id, created_at DESC);

CREATE TABLE request_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_generation_jobs_recovery
  ON generation_jobs(status, stage_updated_at);

CREATE INDEX idx_publish_jobs_recovery
  ON publish_jobs(status, claimed_at, updated_at);

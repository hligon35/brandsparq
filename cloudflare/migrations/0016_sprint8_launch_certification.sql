CREATE TABLE launch_certification_runs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  blockers_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  checks_json TEXT NOT NULL DEFAULT '[]',
  commit_sha TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX idx_launch_certification_runs_created
  ON launch_certification_runs(created_at DESC);

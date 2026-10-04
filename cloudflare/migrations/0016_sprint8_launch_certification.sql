ALTER TABLE notification_deliveries ADD COLUMN receipt_status TEXT;
ALTER TABLE notification_deliveries ADD COLUMN receipt_checked_at TEXT;

CREATE INDEX idx_notification_deliveries_receipts
  ON notification_deliveries(channel, status, receipt_checked_at, sent_at);

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

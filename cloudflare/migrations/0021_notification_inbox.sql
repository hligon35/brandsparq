-- Per-user inbox state preserves shared notices and provider delivery audit history.
CREATE TABLE IF NOT EXISTS notification_inbox (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  read_at TEXT,
  dismissed_at TEXT,
  PRIMARY KEY (user_id, notification_id)
);

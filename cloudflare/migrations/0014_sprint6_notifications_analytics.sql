PRAGMA foreign_keys = ON;

ALTER TABLE notification_preferences ADD COLUMN publish_success_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN publish_failure_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN review_ready_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN prepublish_enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  destination TEXT,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  error_message TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (notification_id) REFERENCES notifications(id)
);

CREATE INDEX idx_notification_deliveries_notification
  ON notification_deliveries(notification_id, channel, status);

CREATE TABLE analytics_daily (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  day TEXT NOT NULL,
  posts INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  UNIQUE(client_id, platform, day)
);

CREATE INDEX idx_analytics_daily_client_day
  ON analytics_daily(client_id, day);

CREATE TABLE analytics_snapshots (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posts INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE INDEX idx_analytics_snapshots_client
  ON analytics_snapshots(client_id, captured_at);

PRAGMA foreign_keys = ON;

ALTER TABLE social_publish_receipts ADD COLUMN provider_status TEXT;
ALTER TABLE social_publish_receipts ADD COLUMN last_checked_at TEXT;
ALTER TABLE social_publish_receipts ADD COLUMN confirmed_at TEXT;
ALTER TABLE social_publish_receipts ADD COLUMN error_code TEXT;
ALTER TABLE social_publish_receipts ADD COLUMN error_category TEXT;
ALTER TABLE social_publish_receipts ADD COLUMN retry_after_seconds INTEGER;

ALTER TABLE social_accounts ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE social_accounts ADD COLUMN health_checked_at TEXT;
ALTER TABLE social_accounts ADD COLUMN permission_status TEXT;
ALTER TABLE social_accounts ADD COLUMN rate_limit_reset_at TEXT;

CREATE INDEX idx_social_receipts_status
  ON social_publish_receipts(status, provider_status, last_checked_at);

CREATE INDEX idx_social_accounts_health
  ON social_accounts(status, health_status, token_expires_at);

CREATE TABLE social_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT,
  external_event_id TEXT,
  payload_json TEXT NOT NULL,
  processed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, external_event_id)
);

CREATE INDEX idx_social_webhook_events_provider
  ON social_webhook_events(provider, created_at);

CREATE TABLE social_status_checks (
  id TEXT PRIMARY KEY,
  receipt_id TEXT,
  social_account_id TEXT,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_status TEXT,
  error_message TEXT,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receipt_id) REFERENCES social_publish_receipts(id),
  FOREIGN KEY (social_account_id) REFERENCES social_accounts(id)
);

CREATE INDEX idx_social_status_checks_receipt
  ON social_status_checks(receipt_id, checked_at);

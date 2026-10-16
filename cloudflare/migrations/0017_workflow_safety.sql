-- Delivery retries must never retry publishing; claims fence overlapping cron runs.
ALTER TABLE notification_deliveries ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notification_deliveries ADD COLUMN retry_at TEXT;
ALTER TABLE notification_deliveries ADD COLUMN claim_until TEXT;
CREATE INDEX idx_notification_deliveries_retry ON notification_deliveries(status, retry_at);
ALTER TABLE generation_jobs ADD COLUMN claim_token TEXT;

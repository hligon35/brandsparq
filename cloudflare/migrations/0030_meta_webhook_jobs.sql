ALTER TABLE social_webhook_events ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'recorded';
ALTER TABLE social_webhook_events ADD COLUMN processing_error TEXT;
ALTER TABLE social_webhook_events ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_webhook_events ADD COLUMN claim_token TEXT;
ALTER TABLE social_webhook_events ADD COLUMN claim_until INTEGER;
CREATE INDEX idx_meta_webhook_pending ON social_webhook_events(processing_status,claim_until,created_at);

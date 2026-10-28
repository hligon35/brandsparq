CREATE TABLE analytics_jobs (
 id TEXT PRIMARY KEY, social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
 range_days INTEGER NOT NULL DEFAULT 90, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, claim_token TEXT, claim_until INTEGER,
 processed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, error_message TEXT
);
CREATE UNIQUE INDEX analytics_jobs_active ON analytics_jobs(social_account_id) WHERE status IN ('queued','running');
CREATE TABLE analytics_job_items (
 job_id TEXT NOT NULL REFERENCES analytics_jobs(id) ON DELETE CASCADE, post_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', PRIMARY KEY(job_id,post_id)
);
CREATE INDEX analytics_jobs_recovery ON analytics_jobs(status,claim_until);
CREATE TRIGGER generation_resource_budget BEFORE INSERT ON generation_jobs
WHEN NEW.request_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM generation_jobs WHERE requested_by=NEW.requested_by AND request_key=NEW.request_key)
AND ((SELECT COUNT(*) FROM generation_jobs WHERE client_id=NEW.client_id AND status IN ('queued','retrying','rendering','processing'))>=10
 OR (SELECT COUNT(*) FROM generation_jobs WHERE client_id=NEW.client_id AND created_at>=datetime('now','-1 day'))>=50)
BEGIN SELECT RAISE(ABORT,'GENERATION_BUDGET_EXCEEDED'); END;
CREATE TRIGGER media_resource_budget BEFORE INSERT ON assets
WHEN NOT EXISTS(SELECT 1 FROM assets WHERE id=NEW.id)
AND (SELECT COUNT(*) FROM assets WHERE client_id=NEW.client_id)>=2000
BEGIN SELECT RAISE(ABORT,'MEDIA_BUDGET_EXCEEDED'); END;
CREATE TRIGGER analytics_resource_budget BEFORE INSERT ON analytics_jobs
WHEN NOT EXISTS(SELECT 1 FROM analytics_jobs WHERE social_account_id=NEW.social_account_id AND status IN ('queued','running'))
AND (SELECT COUNT(*) FROM analytics_jobs WHERE status IN ('queued','running'))>=100
BEGIN SELECT RAISE(ABORT,'Analytics capacity reached. Wait for active syncs to finish, then retry.'); END;

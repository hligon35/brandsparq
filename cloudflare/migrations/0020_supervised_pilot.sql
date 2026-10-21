-- Existing deployments keep their current behavior until an owner enables a hold
-- or a supervised pilot. Returning to broad release is a separate launch decision.
CREATE TABLE pilot_settings (
 id TEXT PRIMARY KEY CHECK(id='default'),
 mode TEXT NOT NULL DEFAULT 'normal' CHECK(mode IN ('normal','hold','supervised')),
 revision INTEGER NOT NULL DEFAULT 0,
 mutation_token TEXT,
 ends_at TEXT,
 release_commit TEXT,
 evidence_json TEXT NOT NULL DEFAULT '{}',
 updated_by TEXT REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO pilot_settings(id) VALUES('default');
CREATE TABLE pilot_destinations (
 client_id TEXT PRIMARY KEY REFERENCES clients(id),
 social_account_id TEXT NOT NULL UNIQUE REFERENCES social_accounts(id)
);
ALTER TABLE publish_jobs ADD COLUMN supervised_by TEXT REFERENCES users(id);
ALTER TABLE publish_jobs ADD COLUMN pilot_revision INTEGER;
ALTER TABLE publish_jobs ADD COLUMN first_claimed_at TEXT;
-- Preserve historical executions when enforcing a new pilot's daily limit.
UPDATE publish_jobs SET first_claimed_at=COALESCE(claimed_at,created_at) WHERE attempt_count>0;
CREATE INDEX idx_publish_jobs_first_claim ON publish_jobs(first_claimed_at,post_id);

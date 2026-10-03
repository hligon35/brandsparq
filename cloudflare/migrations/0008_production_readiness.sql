PRAGMA foreign_keys = ON;

-- Durable logical publish jobs separate one requested publication from its retry attempts.
CREATE TABLE publish_jobs (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  execution_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE INDEX idx_publish_jobs_post ON publish_jobs(post_id, created_at);
CREATE INDEX idx_publish_jobs_state ON publish_jobs(state, updated_at);

-- Make generation retries resume the same logical post slots instead of creating duplicates.
ALTER TABLE posts ADD COLUMN generation_index INTEGER;
CREATE UNIQUE INDEX idx_posts_generation_slot
  ON posts(generation_job_id, generation_index)
  WHERE generation_job_id IS NOT NULL AND generation_index IS NOT NULL;

-- Operational client lifecycle.
ALTER TABLE clients ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE clients ADD COLUMN archived_at TEXT;

-- Brand Brain expansion.
ALTER TABLE brand_profiles ADD COLUMN logo_asset_id TEXT;
ALTER TABLE brand_profiles ADD COLUMN alternate_logo_asset_id TEXT;
ALTER TABLE brand_profiles ADD COLUMN fonts TEXT;
ALTER TABLE brand_profiles ADD COLUMN brand_examples TEXT;
ALTER TABLE brand_profiles ADD COLUMN prohibited_visual_styles TEXT;
ALTER TABLE brand_profiles ADD COLUMN competitor_references TEXT;
ALTER TABLE brand_profiles ADD COLUMN brand_vocabulary TEXT;
ALTER TABLE brand_profiles ADD COLUMN hashtag_policy TEXT;
ALTER TABLE brand_profiles ADD COLUMN cta_library TEXT;
ALTER TABLE brand_profiles ADD COLUMN campaign_goals TEXT;
ALTER TABLE brand_profiles ADD COLUMN target_locations TEXT;
ALTER TABLE brand_profiles ADD COLUMN platform_rules TEXT;

-- Asset integrity metadata.
ALTER TABLE assets ADD COLUMN sha256 TEXT;
ALTER TABLE assets ADD COLUMN aspect_ratio REAL;
CREATE INDEX idx_assets_sha256 ON assets(client_id, sha256);

-- Prevent duplicate social-account connections caused by OAuth races.
CREATE UNIQUE INDEX idx_social_accounts_unique_external
  ON social_accounts(client_id, platform, external_account_id)
  WHERE external_account_id IS NOT NULL;

PRAGMA foreign_keys = ON;

-- Resume generation retries into the same deterministic post slots.
ALTER TABLE posts ADD COLUMN generation_index INTEGER;
CREATE UNIQUE INDEX idx_posts_generation_slot
  ON posts(generation_job_id, generation_index)
  WHERE generation_job_id IS NOT NULL AND generation_index IS NOT NULL;

-- Additional Brand Brain configuration introduced by production readiness.
ALTER TABLE brand_profiles ADD COLUMN cta_library TEXT;
ALTER TABLE brand_profiles ADD COLUMN campaign_goals TEXT;

-- Keep upload integrity and provider account uniqueness enforced in the database.
ALTER TABLE assets ADD COLUMN aspect_ratio REAL;
CREATE INDEX idx_assets_sha256 ON assets(client_id, sha256);

CREATE UNIQUE INDEX idx_social_accounts_unique_external
  ON social_accounts(client_id, platform, external_account_id)
  WHERE external_account_id IS NOT NULL;

PRAGMA foreign_keys = ON;

ALTER TABLE assets ADD COLUMN sha256 TEXT;

CREATE TABLE asset_derivatives (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  UNIQUE(asset_id, kind)
);

CREATE INDEX idx_asset_derivatives_asset
  ON asset_derivatives(asset_id, kind);

CREATE TABLE graphic_jobs (
  id TEXT PRIMARY KEY,
  generation_job_id TEXT NOT NULL,
  post_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (generation_job_id) REFERENCES generation_jobs(id),
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE INDEX idx_graphic_jobs_generation
  ON graphic_jobs(generation_job_id, status);

CREATE TABLE creative_variants (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  is_primary INTEGER NOT NULL DEFAULT 0,
  composition_json TEXT,
  model TEXT,
  response_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  UNIQUE(post_id, variant_key)
);

CREATE INDEX idx_creative_variants_post
  ON creative_variants(post_id, is_primary, created_at);

CREATE TABLE sparq_scores (
  post_id TEXT PRIMARY KEY,
  overall INTEGER NOT NULL,
  brand_match INTEGER NOT NULL,
  readability INTEGER NOT NULL,
  platform_fit INTEGER NOT NULL,
  cta_strength INTEGER NOT NULL,
  composition INTEGER NOT NULL,
  caption_quality INTEGER NOT NULL,
  compliance INTEGER NOT NULL,
  rationale TEXT,
  model TEXT,
  response_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

ALTER TABLE posts ADD COLUMN primary_variant_id TEXT;
ALTER TABLE posts ADD COLUMN creative_composition TEXT;

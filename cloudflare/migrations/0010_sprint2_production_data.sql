PRAGMA foreign_keys = ON;

ALTER TABLE clients ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE clients ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE clients ADD COLUMN archived_at TEXT;

ALTER TABLE brand_profiles ADD COLUMN fonts TEXT;
ALTER TABLE brand_profiles ADD COLUMN brand_examples TEXT;
ALTER TABLE brand_profiles ADD COLUMN prohibited_visual_styles TEXT;
ALTER TABLE brand_profiles ADD COLUMN competitor_references TEXT;
ALTER TABLE brand_profiles ADD COLUMN brand_vocabulary TEXT;
ALTER TABLE brand_profiles ADD COLUMN hashtag_policy TEXT;
ALTER TABLE brand_profiles ADD COLUMN target_locations TEXT;
ALTER TABLE brand_profiles ADD COLUMN platform_rules TEXT;
ALTER TABLE brand_profiles ADD COLUMN logo_asset_id TEXT;
ALTER TABLE brand_profiles ADD COLUMN alternate_logo_asset_id TEXT;

CREATE TABLE brand_assets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'reference',
  label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  UNIQUE(client_id, asset_id, role)
);

CREATE INDEX idx_brand_assets_client
  ON brand_assets(client_id, role, created_at);

CREATE INDEX idx_clients_status
  ON clients(status, name);

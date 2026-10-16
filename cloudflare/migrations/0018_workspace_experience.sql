ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE user_client_access ADD COLUMN permission_role TEXT;
ALTER TABLE brand_profiles ADD COLUMN logo_preference TEXT NOT NULL DEFAULT 'primary';
ALTER TABLE posts ADD COLUMN paused_from_status TEXT;
CREATE TABLE team_invitations (
 id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL,
 client_roles_json TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending', expires_at INTEGER NOT NULL,
 invited_by TEXT NOT NULL REFERENCES users(id), accepted_at INTEGER,
 delivery_status TEXT NOT NULL DEFAULT 'pending', delivery_error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_team_invitations_email ON team_invitations(email,status,expires_at);
CREATE TABLE client_reviewers (
 id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id),
 email TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(client_id,email)
);
ALTER TABLE review_tokens ADD COLUMN revoked_at INTEGER;
CREATE TABLE review_email_deliveries (
 id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id),
 recipient_email TEXT NOT NULL,status TEXT NOT NULL,error_message TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE profile_email_changes (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 email TEXT NOT NULL,
 code_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 requested_at INTEGER NOT NULL
);

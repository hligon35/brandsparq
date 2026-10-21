-- A revision owns the post until it completes or an operator-visible failure releases it.
ALTER TABLE posts ADD COLUMN revision_job_id TEXT;
CREATE TABLE revision_jobs (
 id TEXT PRIMARY KEY,
 post_id TEXT NOT NULL REFERENCES posts(id),
 action TEXT NOT NULL CHECK(action IN ('caption','image','regenerate')),
 instruction TEXT,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','completed','failed')),
 claimed_at TEXT,
 error_message TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_revision_jobs_active ON revision_jobs(post_id) WHERE status IN ('queued','processing');
CREATE INDEX idx_revision_jobs_recovery ON revision_jobs(status,updated_at);

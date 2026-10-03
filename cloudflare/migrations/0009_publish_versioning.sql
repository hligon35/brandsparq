PRAGMA foreign_keys = ON;

ALTER TABLE posts ADD COLUMN publish_version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_posts_publish_version
  ON posts(id, publish_version);

CREATE INDEX idx_publish_jobs_post_status
  ON publish_jobs(post_id, status, created_at);

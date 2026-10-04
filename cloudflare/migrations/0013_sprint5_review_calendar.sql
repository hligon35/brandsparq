PRAGMA foreign_keys = ON;

ALTER TABLE posts ADD COLUMN rejected_at TEXT;
ALTER TABLE posts ADD COLUMN rejection_reason TEXT;
ALTER TABLE posts ADD COLUMN reviewer_comment TEXT;

CREATE TABLE review_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT,
  public_reviewer INTEGER NOT NULL DEFAULT 0,
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_review_comments_post
  ON review_comments(post_id, created_at);

CREATE INDEX idx_posts_calendar_filter
  ON posts(status, client_id, platform, scheduled_publish_at);

CREATE INDEX idx_posts_review_filter
  ON posts(status, client_id, platform, created_at);

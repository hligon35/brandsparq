PRAGMA foreign_keys = ON;

CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  generation_job_id TEXT,
  post_id TEXT,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT NOT NULL,
  prompt_version TEXT,
  response_id TEXT,
  provider_request_id TEXT,
  status TEXT NOT NULL,
  usage_json TEXT,
  metadata_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (generation_job_id) REFERENCES generation_jobs(id),
  FOREIGN KEY (post_id) REFERENCES posts(id)
);

CREATE INDEX idx_ai_runs_job ON ai_runs(generation_job_id, created_at);
CREATE INDEX idx_ai_runs_post ON ai_runs(post_id, created_at);

ALTER TABLE posts ADD COLUMN ai_caption_response_id TEXT;
ALTER TABLE posts ADD COLUMN ai_image_response_id TEXT;
ALTER TABLE posts ADD COLUMN ai_image_prompt TEXT;
ALTER TABLE posts ADD COLUMN ai_image_model TEXT;
ALTER TABLE posts ADD COLUMN ai_last_error TEXT;
ALTER TABLE posts ADD COLUMN graphic_version INTEGER NOT NULL DEFAULT 0;

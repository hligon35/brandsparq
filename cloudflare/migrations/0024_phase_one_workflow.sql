-- A repeated creation request returns the same job, including after a lost response.
ALTER TABLE generation_jobs ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX idx_generation_request_identity ON generation_jobs(requested_by,request_key)
  WHERE request_key IS NOT NULL;

-- Link the current publish reconciliation to its atomic audit entry.
ALTER TABLE posts ADD COLUMN reconciliation_id TEXT;

-- Fence a late cancel/retry/recovery against a newer job control action.
ALTER TABLE generation_jobs ADD COLUMN control_token TEXT;

ALTER TABLE graphic_jobs ADD COLUMN claim_token TEXT;

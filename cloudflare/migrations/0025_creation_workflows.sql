-- Old generation requests retain their campaign contract; new creation requests
-- persist their explicit mode, exact output count and chosen destinations.
ALTER TABLE generation_jobs ADD COLUMN creation_options TEXT;
ALTER TABLE campaigns ADD COLUMN workflow_revision INTEGER NOT NULL DEFAULT 0;

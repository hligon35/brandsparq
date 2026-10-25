-- A client calendar epoch serializes selection plus reservation across isolates.
ALTER TABLE clients ADD COLUMN schedule_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN schedule_token TEXT;

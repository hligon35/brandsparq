-- A workspace owner can start discovery before a client exists.
CREATE TABLE social_oauth_states_import (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  client_id TEXT,
  user_id TEXT,
  state_hash TEXT NOT NULL UNIQUE,
  code_verifier TEXT,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  connection_revisions TEXT NOT NULL DEFAULT '{}',
  import_clients INTEGER NOT NULL DEFAULT 0 CHECK(import_clients IN (0,1)),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  CHECK(import_clients=1 OR client_id IS NOT NULL)
);
INSERT INTO social_oauth_states_import
  (id,platform,client_id,user_id,state_hash,code_verifier,return_to,expires_at,consumed_at,created_at,connection_revisions)
SELECT id,platform,client_id,user_id,state_hash,code_verifier,return_to,expires_at,consumed_at,created_at,connection_revisions
FROM social_oauth_states;
DROP TABLE social_oauth_states;
ALTER TABLE social_oauth_states_import RENAME TO social_oauth_states;
CREATE INDEX idx_social_oauth_state ON social_oauth_states(state_hash,expires_at);

-- Staging migrations always restore the publishing hold. Acceptance and an
-- explicit owner decision are required before any supervised publishing.
UPDATE pilot_settings SET mode='hold',revision=revision+1,
 mutation_token=lower(hex(randomblob(16))),updated_by=NULL,updated_at=CURRENT_TIMESTAMP
 WHERE id='default';

UPDATE workspace_settings SET default_no_response_policy='hold' WHERE id='default';
UPDATE notification_preferences SET no_response_policy='hold';
-- The selected pilot scope is an internal test workspace. No social destination,
-- user, session or credential is copied from production.
INSERT OR IGNORE INTO clients(id,name,timezone) VALUES ('acceptance-internal','BrandSparQ Internal Acceptance','America/Indiana/Indianapolis');
INSERT INTO client_settings(client_id,no_response_policy)
SELECT id,'hold' FROM clients WHERE 1=1
ON CONFLICT(client_id) DO UPDATE SET no_response_policy='hold';

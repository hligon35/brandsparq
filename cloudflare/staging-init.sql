-- Staging migrations always restore the publishing hold. Acceptance and an
-- explicit owner decision are required before any supervised publishing.
UPDATE pilot_settings SET mode='hold',revision=revision+1,
 mutation_token=lower(hex(randomblob(16))),updated_by=NULL,updated_at=CURRENT_TIMESTAMP
 WHERE id='default';

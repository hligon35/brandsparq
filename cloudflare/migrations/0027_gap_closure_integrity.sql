-- Revisions describe the data actually seen by an editor, not request arrival time.
ALTER TABLE clients ADD COLUMN edit_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN edit_token TEXT;
ALTER TABLE posts ADD COLUMN review_edit_token TEXT;
ALTER TABLE campaigns ADD COLUMN edit_token TEXT;
ALTER TABLE posts ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_accounts ADD COLUMN connection_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_accounts ADD COLUMN refresh_claim TEXT;
ALTER TABLE social_accounts ADD COLUMN refresh_until INTEGER;
ALTER TABLE social_oauth_states ADD COLUMN connection_revisions TEXT NOT NULL DEFAULT '{}';

CREATE TRIGGER clients_identity_revision AFTER UPDATE OF name,timezone ON clients
WHEN NEW.name IS NOT OLD.name OR NEW.timezone IS NOT OLD.timezone
BEGIN UPDATE clients SET edit_revision=edit_revision+1 WHERE id=NEW.id; END;
CREATE TRIGGER brand_insert_revision AFTER INSERT ON brand_profiles
BEGIN UPDATE clients SET edit_revision=edit_revision+1 WHERE id=NEW.client_id; END;
CREATE TRIGGER brand_update_revision AFTER UPDATE ON brand_profiles
BEGIN UPDATE clients SET edit_revision=edit_revision+1 WHERE id=NEW.client_id; END;
CREATE TRIGGER brand_delete_revision AFTER DELETE ON brand_profiles
BEGIN UPDATE clients SET edit_revision=edit_revision+1 WHERE id=OLD.client_id; END;
CREATE TRIGGER post_content_revision AFTER UPDATE OF title,headline,caption,hashtags,graphic_key,social_account_id,reviewer_comment ON posts
WHEN NEW.content_revision=OLD.content_revision AND (NEW.title IS NOT OLD.title OR NEW.headline IS NOT OLD.headline
 OR NEW.caption IS NOT OLD.caption OR NEW.hashtags IS NOT OLD.hashtags
 OR NEW.graphic_key IS NOT OLD.graphic_key OR NEW.social_account_id IS NOT OLD.social_account_id
 OR NEW.reviewer_comment IS NOT OLD.reviewer_comment)
BEGIN UPDATE posts SET content_revision=content_revision+1 WHERE id=NEW.id; END;

-- Schema admission must reject this Worker until policy migration is applied.
ALTER TABLE workspace_settings ADD COLUMN personal_preferences_version INTEGER NOT NULL DEFAULT 1;

-- Move legacy owner publishing behavior into workspace controls before separating personal alerts.
-- Preserve every existing hold; unknown policies also fail closed. A skip outranks auto-publish.
UPDATE workspace_settings SET default_no_response_policy = CASE
  WHEN default_no_response_policy NOT IN ('auto_publish','hold','skip') OR default_no_response_policy='hold'
    OR EXISTS(SELECT 1 FROM notification_preferences n JOIN users u ON u.id=n.user_id
      WHERE u.role='owner' AND u.status='active' AND (n.no_response_policy='hold' OR n.no_response_policy NOT IN ('auto_publish','hold','skip'))) THEN 'hold'
  WHEN default_no_response_policy='skip' OR EXISTS(SELECT 1 FROM notification_preferences n JOIN users u ON u.id=n.user_id
      WHERE u.role='owner' AND u.status='active' AND n.no_response_policy='skip') THEN 'skip'
  ELSE 'auto_publish' END,
  default_prepublish_minutes=MAX(default_prepublish_minutes,COALESCE((SELECT MAX(n.prepublish_minutes)
    FROM notification_preferences n JOIN users u ON u.id=n.user_id WHERE u.role='owner' AND u.status='active'),default_prepublish_minutes));

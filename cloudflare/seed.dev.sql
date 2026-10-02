INSERT OR IGNORE INTO clients (id, name, timezone) VALUES
  ('alpha', 'AlphaZoneLabs', 'America/Indiana/Indianapolis'),
  ('lifeprep', 'LifePrep', 'America/Chicago'),
  ('b3u', 'B3 Unstoppable', 'America/New_York');

INSERT OR IGNORE INTO brand_profiles
  (id, client_id, voice, audience, primary_color, secondary_color, website)
VALUES
  ('brand-alpha', 'alpha', 'Clear, innovative, practical', 'Businesses needing digital systems', '#A56CFF', '#11131A', 'https://alphazonelabs.com');

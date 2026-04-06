-- Create app_config table for global feature flags
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT 'false'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Everyone can read config (drivers need to check the flag)
CREATE POLICY "Anyone can read app_config"
  ON app_config FOR SELECT
  USING (true);

-- Only authenticated users (admins) can update
CREATE POLICY "Authenticated users can update app_config"
  ON app_config FOR UPDATE
  USING (true);

CREATE POLICY "Authenticated users can insert app_config"
  ON app_config FOR INSERT
  WITH CHECK (true);

-- Seed the feature flag (off by default)
INSERT INTO app_config (key, value) VALUES
  ('driver_advanced_features', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

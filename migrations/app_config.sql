-- Add per-driver feature flag column
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS advanced_features BOOLEAN NOT NULL DEFAULT false;

-- OPTIONAL: app_config table is no longer needed for this feature.
-- If you already created it, you can drop it or keep it for future use.
-- DROP TABLE IF EXISTS app_config;

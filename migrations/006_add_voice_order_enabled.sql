-- ═══════════════════════════════════════════════════
-- Cecilia Bakery — Migration 006
-- Add voice_order_enabled to drivers table
-- ═══════════════════════════════════════════════════
-- Purpose: Adds a boolean flag to enable/disable AI voice ordering per driver.
-- Same pattern as scanner_enabled (migration 005).
-- Default: false (admin must enable per driver).

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS voice_order_enabled BOOLEAN DEFAULT false;

-- Add a comment for documentation
COMMENT ON COLUMN drivers.voice_order_enabled IS 'When true, driver sees the AI voice ordering mic button on their New Order form';

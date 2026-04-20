-- Migration 005: Add scanner_enabled flag to drivers table
-- Client: Cecilia Bakery
-- Purpose: Controls whether the ticket scanner (OCR camera) feature is available
--          when this driver is selected in the admin New Order flow.
--          Separate from advanced_features (which controls other premium features).
-- Date: 2026-04-19

-- 1. Add the new column (defaults to false for all drivers)
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS scanner_enabled BOOLEAN DEFAULT FALSE;

-- 2. Enable scanner for Topal only
UPDATE public.drivers
  SET scanner_enabled = TRUE
  WHERE name = 'Topal';

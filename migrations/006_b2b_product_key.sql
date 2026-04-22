-- Cecilia Bakery — B2B Product Key
-- Migration 006: Add stable product_key column to b2b_products
-- Purpose: Each B2B product gets a unique key (b2b_{uuid}) that never
--          collides with hardcoded driver catalog keys (pina, tl, pz_rv…).
--          Used in driver_prices, order items, and dedup checks.
-- ═══════════════════════════════════════════════════════════════

-- 1. Add the column (nullable first so backfill works)
ALTER TABLE b2b_products ADD COLUMN IF NOT EXISTS product_key TEXT;

-- 2. Backfill existing rows with b2b_{id}
UPDATE b2b_products SET product_key = 'b2b_' || id WHERE product_key IS NULL;

-- 3. Make NOT NULL + unique going forward
ALTER TABLE b2b_products ALTER COLUMN product_key SET NOT NULL;

-- Create unique index (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_b2b_products_product_key
  ON b2b_products (product_key);

-- DONE. No data modifications, no deletes.
-- This only adds 1 column to existing rows.

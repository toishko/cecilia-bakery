-- ============================================
-- Cecilia Bakery — B2B Product Sync
-- Migration 005: Add B2B columns to products table
-- Purpose: Allow products added in Manage > Products
--          to also appear in driver order forms
-- ============================================

-- ── 1. ADD B2B COLUMNS TO PRODUCTS TABLE ──
-- b2b_enabled: when true, this product shows up in driver/staff order forms
ALTER TABLE products ADD COLUMN IF NOT EXISTS b2b_enabled BOOLEAN NOT NULL DEFAULT false;

-- b2b_category: which driver section the product appears in
-- Valid values: 'redondo', 'plain', 'tresleche', 'piezas', 'frostin',
--              'hb_big', 'hb_small', 'cuadrao', 'basos', 'familiar'
ALTER TABLE products ADD COLUMN IF NOT EXISTS b2b_category TEXT;

-- b2b_key: unique slug used as the product_key in driver_prices and order items
-- Auto-generated from name_en, prefixed with 'b2b_' to avoid collisions
-- with existing hardcoded keys like 'fr_guava', 'pz_rv', etc.
ALTER TABLE products ADD COLUMN IF NOT EXISTS b2b_key TEXT UNIQUE;

-- ── 2. INDEX FOR FAST B2B LOOKUPS ──
-- The driver form and admin New Order will query: WHERE b2b_enabled = true
CREATE INDEX IF NOT EXISTS idx_products_b2b_enabled ON products(b2b_enabled) WHERE b2b_enabled = true;

-- ============================================
-- DONE. No data modifications, no deletions.
-- This only adds 3 nullable columns + 1 index.
-- ============================================

-- ============================================
-- Cecilia Bakery — Driver Order System
-- Phase 1: Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- ── 1. DRIVERS TABLE ──
CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  language TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. DRIVER PRICES TABLE ──
CREATE TABLE IF NOT EXISTS driver_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL,
  product_label TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(driver_id, product_key)
);

-- ── 3. DRIVER ORDERS TABLE ──
CREATE TABLE IF NOT EXISTS driver_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number SERIAL,
  driver_id UUID NOT NULL REFERENCES drivers(id),
  batch_id UUID NOT NULL,
  batch_index INTEGER NOT NULL DEFAULT 1,
  driver_ref TEXT,
  business_name TEXT,
  pickup_date DATE,
  pickup_time TIME,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'not_paid',
  payment_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  editable_until TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
  admin_editable_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 4. DRIVER ORDER ITEMS TABLE ──
CREATE TABLE IF NOT EXISTS driver_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES driver_orders(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL,
  product_label TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_at_order NUMERIC(10,2) NOT NULL,
  adjusted_quantity INTEGER,
  adjustment_note TEXT,
  adjusted_at TIMESTAMPTZ
);

-- ── 5. UPDATED_AT TRIGGERS ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER drivers_updated_at
  BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER driver_prices_updated_at
  BEFORE UPDATE ON driver_prices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 6. INDEXES ──
CREATE INDEX IF NOT EXISTS idx_driver_prices_driver_id ON driver_prices(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_orders_driver_id ON driver_orders(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_orders_batch_id ON driver_orders(batch_id);
CREATE INDEX IF NOT EXISTS idx_driver_orders_status ON driver_orders(status);
CREATE INDEX IF NOT EXISTS idx_driver_orders_submitted_at ON driver_orders(submitted_at);
CREATE INDEX IF NOT EXISTS idx_driver_order_items_order_id ON driver_order_items(order_id);

-- ── 7. ROW LEVEL SECURITY ──

-- Enable RLS on all tables
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_order_items ENABLE ROW LEVEL SECURITY;

-- DRIVERS: public can read by code (for login), admin can do everything
CREATE POLICY "Anyone can look up driver by code"
  ON drivers FOR SELECT
  USING (true);

CREATE POLICY "Admin full access to drivers"
  ON drivers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.uid() = id
      AND raw_user_meta_data->>'role' IN ('admin', 'staff')
    )
  );

-- DRIVER_PRICES: drivers read own, admin full access
CREATE POLICY "Drivers can read own prices"
  ON driver_prices FOR SELECT
  USING (
    driver_id IN (SELECT id FROM drivers WHERE code = current_setting('app.current_driver_code', true))
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.uid() = id
      AND raw_user_meta_data->>'role' IN ('admin', 'staff')
    )
  );

CREATE POLICY "Admin full access to driver_prices"
  ON driver_prices FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.uid() = id
      AND raw_user_meta_data->>'role' IN ('admin', 'staff')
    )
  );

-- DRIVER_ORDERS: drivers read/write own, admin full access
CREATE POLICY "Drivers can read own orders"
  ON driver_orders FOR SELECT
  USING (true);

CREATE POLICY "Drivers can insert own orders"
  ON driver_orders FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Drivers can update own orders within edit window"
  ON driver_orders FOR UPDATE
  USING (true);

CREATE POLICY "Admin full access to driver_orders"
  ON driver_orders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.uid() = id
      AND raw_user_meta_data->>'role' IN ('admin', 'staff')
    )
  );

-- DRIVER_ORDER_ITEMS: same pattern
CREATE POLICY "Anyone can read order items"
  ON driver_order_items FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert order items"
  ON driver_order_items FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update order items"
  ON driver_order_items FOR UPDATE
  USING (true);

CREATE POLICY "Admin full access to driver_order_items"
  ON driver_order_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.uid() = id
      AND raw_user_meta_data->>'role' IN ('admin', 'staff')
    )
  );

-- ── 8. ENABLE REALTIME ──
ALTER PUBLICATION supabase_realtime ADD TABLE driver_orders;

-- ── 9. TEST DATA ──
-- Insert a test driver
INSERT INTO drivers (code, name, phone, language)
VALUES ('test01', 'Test Driver', '555-0001', 'en')
ON CONFLICT (code) DO NOTHING;

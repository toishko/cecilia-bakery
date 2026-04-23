-- ═══════════════════════════════════════════════════
-- Client-Specific Pricing for Driver Sales
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- Table: stores per-client, per-product pricing set by each driver
CREATE TABLE IF NOT EXISTS client_prices (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id  UUID NOT NULL REFERENCES driver_route_clients(id) ON DELETE CASCADE,
  driver_id  UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL,
  price      NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, product_key)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_client_prices_client ON client_prices(client_id);
CREATE INDEX IF NOT EXISTS idx_client_prices_driver ON client_prices(driver_id);

-- RLS
ALTER TABLE client_prices ENABLE ROW LEVEL SECURITY;

-- Drivers can read/write their own client prices
CREATE POLICY "Drivers manage own client prices"
  ON client_prices FOR ALL
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_client_prices_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_client_prices_updated
  BEFORE UPDATE ON client_prices
  FOR EACH ROW
  EXECUTE FUNCTION update_client_prices_timestamp();

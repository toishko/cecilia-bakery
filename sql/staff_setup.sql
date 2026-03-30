-- ═══════════════════════════════════════════════════════════════
--  STAFF PORTAL: Database Setup
--  Run in Supabase SQL Editor
--  Creates box_presets table with RLS and seed data
-- ═══════════════════════════════════════════════════════════════

-- ── Box size presets table ──
-- Staff use these to calculate how many boxes are needed per product
CREATE TABLE IF NOT EXISTS box_presets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_tag text NOT NULL,
  label text NOT NULL,
  pieces_per_box integer NOT NULL,
  created_by text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE box_presets ENABLE ROW LEVEL SECURITY;

-- Staff and admin can read all presets
CREATE POLICY "Box presets: staff and admin read"
  ON box_presets FOR SELECT
  USING (true);

-- Only admin can insert/update/delete presets
CREATE POLICY "Box presets: admin write"
  ON box_presets FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Box presets: admin update"
  ON box_presets FOR UPDATE
  USING (is_admin());

CREATE POLICY "Box presets: admin delete"
  ON box_presets FOR DELETE
  USING (is_admin());

-- ── Seed default presets for common products ──
INSERT INTO box_presets (product_tag, label, pieces_per_box) VALUES
  ('tres-leches', 'Small Box', 42),
  ('tres-leches', 'Large Box', 52),
  ('square-cake', 'Standard Box', 12),
  ('birthday-cake', 'Standard Box', 6),
  ('slice', 'Small Box', 24),
  ('slice', 'Large Box', 36),
  ('cups', 'Standard Box', 48)
ON CONFLICT DO NOTHING;

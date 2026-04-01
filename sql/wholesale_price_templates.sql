-- Create wholesale_price_templates table
CREATE TABLE IF NOT EXISTS wholesale_price_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  prices jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: allow all for authenticated (admin dashboard uses service-level access)
ALTER TABLE wholesale_price_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for wholesale_price_templates"
  ON wholesale_price_templates
  FOR ALL
  USING (true)
  WITH CHECK (true);

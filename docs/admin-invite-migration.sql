-- ═══════════════════════════════════
--  Admin Invite Codes Table
--  Run this in Supabase SQL Editor
-- ═══════════════════════════════════

CREATE TABLE IF NOT EXISTS admin_invite_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,          -- email of admin who created
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,   -- auto-expire after 24h
  used_by TEXT,                      -- email of admin who used it
  used_at TIMESTAMPTZ,
  is_used BOOLEAN DEFAULT FALSE
);

-- RLS: allow authenticated users to read/insert/update
ALTER TABLE admin_invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON admin_invite_codes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert" ON admin_invite_codes
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update" ON admin_invite_codes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Also allow anon to SELECT (needed for registration validation)
CREATE POLICY "Allow anon read" ON admin_invite_codes
  FOR SELECT TO anon USING (true);

-- Allow anon to UPDATE (mark code as used during registration)
CREATE POLICY "Allow anon update" ON admin_invite_codes
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

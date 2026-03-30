-- ═══════════════════════════════════════════════════════════════
--  ADD EMAIL COLUMN TO PROFILES
--  Run in Supabase SQL Editor
--  Allows staff management UI to show emails alongside Clerk IDs
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;

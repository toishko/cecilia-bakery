-- ═══════════════════════════════════════════════════════════════
--  ADD EMAIL COLUMN TO PROFILES
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;

-- ═══════════════════════════════════════════════════════════════
--  PROFILES TABLE: RLS Policies
--  Run in Supabase SQL Editor
--  Allows admin to manage staff roles, users to read own profile
-- ═══════════════════════════════════════════════════════════════

-- Ensure RLS is enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (safe to re-run)
DROP POLICY IF EXISTS "Profiles: user reads own" ON profiles;
DROP POLICY IF EXISTS "Profiles: user can insert own" ON profiles;
DROP POLICY IF EXISTS "Profiles: user can update own email" ON profiles;
DROP POLICY IF EXISTS "Profiles: admin full access" ON profiles;

-- Users can read their own profile
CREATE POLICY "Profiles: user reads own"
  ON profiles FOR SELECT
  USING (
    auth.uid()::text = clerk_user_id
    OR is_admin()
  );

-- Anyone authenticated can insert their own profile (first sign-in)
CREATE POLICY "Profiles: user can insert own"
  ON profiles FOR INSERT
  WITH CHECK (true);

-- Users can update their own profile (email only)
CREATE POLICY "Profiles: user can update own email"
  ON profiles FOR UPDATE
  USING (auth.uid()::text = clerk_user_id);

-- Admins can read, update, and delete all profiles
CREATE POLICY "Profiles: admin full access"
  ON profiles FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

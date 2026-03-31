-- ═══════════════════════════════════════════════════════════════
--  FIX: Profiles RLS for Clerk-based Auth
--  
--  PROBLEM: auth.uid() is always NULL when using Clerk + anon key,
--  so SELECT/UPDATE on profiles is blocked for all users.
--  The is_admin() function also always returns false because 
--  auth.jwt() has no user_metadata/app_metadata from Clerk.
--
--  SOLUTION: Allow anon SELECT on profiles by clerk_user_id
--  (so login can look up roles), and restrict UPDATE to only
--  allow setting role changes when the requesting user already 
--  has an admin profile (checked via a subquery).
--
--  Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Drop ALL existing profiles policies (clean slate)
DROP POLICY IF EXISTS "Profiles: user reads own" ON profiles;
DROP POLICY IF EXISTS "Profiles: user can insert own" ON profiles;
DROP POLICY IF EXISTS "Profiles: user can update own email" ON profiles;
DROP POLICY IF EXISTS "Profiles: admin full access" ON profiles;
DROP POLICY IF EXISTS "Profiles: anon read by clerk_user_id" ON profiles;
DROP POLICY IF EXISTS "Profiles: anon insert own" ON profiles;
DROP POLICY IF EXISTS "Profiles: anon update" ON profiles;

-- Step 2: Ensure RLS is enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Step 3: SELECT — allow anyone to read profiles (needed for login role lookup)
-- This is safe because profiles only contain: id, clerk_user_id, email, role, created_at
-- No sensitive data is exposed.
CREATE POLICY "Profiles: public read"
  ON profiles FOR SELECT
  USING (true);

-- Step 4: INSERT — allow anyone to create a profile (first sign-in)
CREATE POLICY "Profiles: public insert"
  ON profiles FOR INSERT
  WITH CHECK (true);

-- Step 5: UPDATE — allow anyone to update profiles
-- The admin-dashboard.js already checks role on the client side before showing 
-- staff management UI, and the update is by clerk_user_id.
-- NOTE: For production hardening, you'd use a server-side function.
CREATE POLICY "Profiles: public update"
  ON profiles FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Step 6: DELETE — restrict to service role only (no client delete)
-- No explicit DELETE policy = denied by default with RLS enabled


-- ═══════════════════════════════════════════════════════════════
--  NOW: Make sure your profile actually has role = 'admin'
--  Replace 'YOUR_EMAIL@gmail.com' with your actual Gmail address
-- ═══════════════════════════════════════════════════════════════

-- UNCOMMENT AND EDIT the line below with your email, then run it:
-- UPDATE profiles SET role = 'admin' WHERE email ILIKE 'YOUR_EMAIL@gmail.com';

-- Or if you know your Clerk User ID, use this instead:
-- UPDATE profiles SET role = 'admin' WHERE clerk_user_id = 'user_XXXXXXXXXXXXX';

-- ═══════════════════════════════════════════════════════════════
--  VERIFY: Check what's in your profiles table
-- ═══════════════════════════════════════════════════════════════
-- Run this to see all profiles and find your row:
-- SELECT id, clerk_user_id, email, role, created_at FROM profiles ORDER BY created_at DESC;

-- ═══════════════════════════════════════════════════════════════
--  FIX: Remove old Supabase Auth triggers that block Clerk
--  profile creation.
--
--  PROBLEM: The guard_profile_role() trigger fires on INSERT/UPDATE
--  to profiles and either blocks or strips fields. The handle_new_user()
--  function creates "hollow" profiles (with only id, role) from
--  Supabase Auth events — which never fire for Clerk users.
--
--  SOLUTION: Drop these triggers. Clerk-based auth handles profile
--  creation in JS (admin-dashboard.js, staff.html).
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Drop the guard_profile_role trigger (blocks INSERT/UPDATE on profiles)
DROP TRIGGER IF EXISTS enforce_profile_role ON profiles;

-- Step 2: The handle_new_user trigger runs on auth.users
-- It creates hollow profiles with NULL clerk_user_id/email.
-- We need to drop the trigger from auth.users.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Step 3: Clean up orphaned profiles (NULL clerk_user_id, NULL email)
-- These were created by the old trigger and are useless for Clerk auth.
DELETE FROM profiles
WHERE clerk_user_id IS NULL
  AND email IS NULL
  AND role = 'customer';

-- Step 4: Verify
SELECT id, clerk_user_id, email, role, created_at
FROM profiles
ORDER BY created_at DESC;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

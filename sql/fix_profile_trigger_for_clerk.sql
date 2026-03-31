-- ═══════════════════════════════════════════════════════════════
--  FIX: Remove old Supabase Auth constraints that block Clerk
--  profile creation.
--
--  PROBLEM: The profiles_id_fkey foreign key constraint requires
--  every profile's id to exist in auth.users. Since Clerk users
--  do NOT exist in Supabase Auth, ALL profile inserts fail with:
--    ERROR 23503: violates foreign key constraint "profiles_id_fkey"
--
--  SOLUTION: Drop the constraint. Clerk handles auth, not Supabase.
-- ═══════════════════════════════════════════════════════════════

-- Drop the foreign key constraint
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Also drop triggers (in case they weren't dropped already)
DROP TRIGGER IF EXISTS enforce_profile_role ON profiles;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Clean up orphaned profiles
DELETE FROM profiles
WHERE clerk_user_id IS NULL
  AND email IS NULL
  AND role = 'customer';

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- Verify
SELECT id, clerk_user_id, email, role, created_at
FROM profiles
ORDER BY created_at DESC;

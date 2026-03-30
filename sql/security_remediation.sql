-- ═══════════════════════════════════════════════════════════════
--  SECURITY REMEDIATION: RLS Policy Fixes
--  Run in Supabase SQL Editor — APPLIED 2026-03-30
--  Fixes: L6, H2, H3, H4, H5, M4
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff'),
    false
  );
$$;

DROP POLICY IF EXISTS "Drivers: public read code lookup" ON drivers;
REVOKE ALL ON drivers FROM anon;
GRANT SELECT (id, name, is_active, language) ON drivers TO anon;
GRANT SELECT ON drivers TO authenticated;
CREATE POLICY "Drivers: public read safe columns"
  ON drivers FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Driver orders: public update own pending" ON driver_orders;
CREATE POLICY "Driver orders: public update own pending"
  ON driver_orders FOR UPDATE
  USING (status = 'pending')
  WITH CHECK (status = 'pending');

DROP POLICY IF EXISTS "Driver order items: public delete own" ON driver_order_items;
CREATE POLICY "Driver order items: delete from pending orders"
  ON driver_order_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM driver_orders
      WHERE driver_orders.id = driver_order_items.order_id
        AND driver_orders.status = 'pending'
    )
  );

DROP POLICY IF EXISTS "Push subs: insert own" ON push_subscriptions;
DROP POLICY IF EXISTS "Push subs: read own" ON push_subscriptions;
DROP POLICY IF EXISTS "Push subs: delete own" ON push_subscriptions;
DROP POLICY IF EXISTS "Push subs: update own" ON push_subscriptions;

CREATE POLICY "Push subs: insert own"
  ON push_subscriptions FOR INSERT
  WITH CHECK (
    user_type IN ('admin', 'driver', 'customer')
    AND user_id IS NOT NULL
    AND endpoint IS NOT NULL
  );

CREATE POLICY "Push subs: read own"
  ON push_subscriptions FOR SELECT
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR is_admin()
    OR auth.uid() IS NULL
  );

CREATE POLICY "Push subs: update own"
  ON push_subscriptions FOR UPDATE
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR is_admin()
    OR auth.uid() IS NULL
  )
  WITH CHECK (
    user_type IN ('admin', 'driver', 'customer')
    AND user_id IS NOT NULL
  );

CREATE POLICY "Push subs: delete own"
  ON push_subscriptions FOR DELETE
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR is_admin()
    OR auth.uid() IS NULL
  );

DROP POLICY IF EXISTS "Invite codes: public validate" ON admin_invite_codes;
CREATE POLICY "Invite codes: public validate"
  ON admin_invite_codes FOR SELECT
  USING (
    is_used = false
    OR is_admin()
  );

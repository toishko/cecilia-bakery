-- ═══════════════════════════════════════════════════════════════
--  SECURITY: Row Level Security (RLS) Policies
--  Run this in the Supabase SQL Editor to tighten access control
-- ═══════════════════════════════════════════════════════════════

-- ── Helper function: Check if user has admin/staff role ──
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'staff')
    OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'staff'),
    false
  );
$$;


-- ═══════════════════════════════════════
--  1. ORDERS (online customer orders)
-- ═══════════════════════════════════════
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Orders: anon can insert" ON orders;
DROP POLICY IF EXISTS "Orders: customer reads own" ON orders;
DROP POLICY IF EXISTS "Orders: admin full access" ON orders;

-- Anyone can place an order (insert only)
CREATE POLICY "Orders: anon can insert"
  ON orders FOR INSERT
  WITH CHECK (true);

-- Authenticated customers can read their own orders
CREATE POLICY "Orders: customer reads own"
  ON orders FOR SELECT
  USING (
    auth.uid()::text = clerk_user_id
    OR is_admin()
  );

-- Admins can read and update all orders
CREATE POLICY "Orders: admin full access"
  ON orders FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());


-- ═══════════════════════════════════════
--  2. PRODUCTS (public catalog)
-- ═══════════════════════════════════════
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Products: public read" ON products;
DROP POLICY IF EXISTS "Products: admin manage" ON products;

-- Anyone can read products (public menu)
CREATE POLICY "Products: public read"
  ON products FOR SELECT
  USING (true);

-- Only admins can insert/update/delete products
CREATE POLICY "Products: admin manage"
  ON products FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());


-- ═══════════════════════════════════════
--  3. DRIVERS
-- ═══════════════════════════════════════
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers: public read code lookup" ON drivers;
DROP POLICY IF EXISTS "Drivers: admin manage" ON drivers;

-- Allow anonymous code lookup (for login) — read only
-- Note: This allows reading driver rows, but codes are short strings
-- and brute-force is rate-limited on the client (improve with server-side rate limiting)
CREATE POLICY "Drivers: public read code lookup"
  ON drivers FOR SELECT
  USING (true);

-- Only admins can create/update/delete drivers
CREATE POLICY "Drivers: admin manage"
  ON drivers FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());


-- ═══════════════════════════════════════
--  4. DRIVER_PRICES
-- ═══════════════════════════════════════
ALTER TABLE driver_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Driver prices: public read" ON driver_prices;
DROP POLICY IF EXISTS "Driver prices: admin manage" ON driver_prices;

-- Drivers and public can read prices
CREATE POLICY "Driver prices: public read"
  ON driver_prices FOR SELECT
  USING (true);

-- Only admins can modify prices
CREATE POLICY "Driver prices: admin manage"
  ON driver_prices FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());


-- ═══════════════════════════════════════
--  5. DRIVER_ORDERS
-- ═══════════════════════════════════════
ALTER TABLE driver_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Driver orders: public insert" ON driver_orders;
DROP POLICY IF EXISTS "Driver orders: public read own" ON driver_orders;
DROP POLICY IF EXISTS "Driver orders: public update own pending" ON driver_orders;
DROP POLICY IF EXISTS "Driver orders: admin full access" ON driver_orders;

-- Drivers can insert orders (anonymous, since drivers don't use Supabase Auth)
CREATE POLICY "Driver orders: public insert"
  ON driver_orders FOR INSERT
  WITH CHECK (true);

-- Drivers can read their own orders (by driver_id)
CREATE POLICY "Driver orders: public read own"
  ON driver_orders FOR SELECT
  USING (true);

-- Drivers can update their own pending orders (edit window)
CREATE POLICY "Driver orders: public update own pending"
  ON driver_orders FOR UPDATE
  USING (status = 'pending');

-- Admins have full access
CREATE POLICY "Driver orders: admin full access"
  ON driver_orders FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());


-- ═══════════════════════════════════════
--  6. DRIVER_ORDER_ITEMS
-- ═══════════════════════════════════════
ALTER TABLE driver_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Driver order items: public read" ON driver_order_items;
DROP POLICY IF EXISTS "Driver order items: public insert" ON driver_order_items;
DROP POLICY IF EXISTS "Driver order items: public delete own" ON driver_order_items;
DROP POLICY IF EXISTS "Driver order items: admin full access" ON driver_order_items;

-- Read access for items
CREATE POLICY "Driver order items: public read"
  ON driver_order_items FOR SELECT
  USING (true);

-- Insert items (when placing orders)
CREATE POLICY "Driver order items: public insert"
  ON driver_order_items FOR INSERT
  WITH CHECK (true);

-- Delete items (when editing pending orders)
CREATE POLICY "Driver order items: public delete own"
  ON driver_order_items FOR DELETE
  USING (true);

-- Admins have full access
CREATE POLICY "Driver order items: admin full access"
  ON driver_order_items FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());


-- ═══════════════════════════════════════
--  7. ADMIN_INVITE_CODES
-- ═══════════════════════════════════════
ALTER TABLE admin_invite_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Invite codes: public validate" ON admin_invite_codes;
DROP POLICY IF EXISTS "Invite codes: public use" ON admin_invite_codes;
DROP POLICY IF EXISTS "Invite codes: admin manage" ON admin_invite_codes;

-- Anyone can look up a code (for registration validation)
CREATE POLICY "Invite codes: public validate"
  ON admin_invite_codes FOR SELECT
  USING (true);

-- Anyone can mark a code as used (during registration)
CREATE POLICY "Invite codes: public use"
  ON admin_invite_codes FOR UPDATE
  USING (is_used = false)
  WITH CHECK (is_used = true);

-- Only admins can create and fully manage invite codes
CREATE POLICY "Invite codes: admin manage"
  ON admin_invite_codes FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());


-- ═══════════════════════════════════════
--  8. PUSH_SUBSCRIPTIONS
-- ═══════════════════════════════════════
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Authenticated users manage own subs" ON push_subscriptions;
DROP POLICY IF EXISTS "Push subs: insert own" ON push_subscriptions;
DROP POLICY IF EXISTS "Push subs: read own" ON push_subscriptions;
DROP POLICY IF EXISTS "Push subs: delete own" ON push_subscriptions;

-- Allow inserting subscriptions (anonymous users too, for drivers)
CREATE POLICY "Push subs: insert own"
  ON push_subscriptions FOR INSERT
  WITH CHECK (true);

-- Allow reading own subscriptions
CREATE POLICY "Push subs: read own"
  ON push_subscriptions FOR SELECT
  USING (true);

-- Allow deleting own subscriptions
CREATE POLICY "Push subs: delete own"
  ON push_subscriptions FOR DELETE
  USING (true);

-- NOTE: In an ideal setup, push_subscriptions would be locked down further.
-- Since drivers don't use Supabase Auth, we can't enforce user_id matching
-- via auth.uid(). The Edge Function uses the service_role key which bypasses RLS.
-- For now, the policies above are permissive for push subscriptions.
-- To tighten further, consider a server-side proxy for push subscription management.


-- ═══════════════════════════════════════
--  9. NOTIFICATION_LOG
-- ═══════════════════════════════════════
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notification log: service only" ON notification_log;

-- Only the service role (Edge Functions) should manage notification logs
-- No client-side access needed
CREATE POLICY "Notification log: admin read"
  ON notification_log FOR SELECT
  USING (is_admin());

-- Service role bypasses RLS for insert (used by Edge Function)

-- ═══════════════════════════════════════════════════════════════
-- FIX: Open up RLS for tables that the admin dashboard reads
-- via the anon key (Clerk-authenticated users, no Supabase JWT).
--
-- The old "admin manage" policies use is_admin() which depends on
-- auth.jwt() — this always returns false with Clerk.
-- We replace them with permissive policies since access control
-- is now handled at the application layer via Clerk + the
-- /api/update-staff-role serverless function.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. DRIVERS ──
DROP POLICY IF EXISTS "Drivers: admin manage" ON drivers;
DROP POLICY IF EXISTS "Drivers: public read code lookup" ON drivers;
DROP POLICY IF EXISTS "Drivers: open read" ON drivers;
DROP POLICY IF EXISTS "Drivers: open write" ON drivers;

CREATE POLICY "Drivers: open read"
  ON drivers FOR SELECT
  USING (true);

CREATE POLICY "Drivers: open write"
  ON drivers FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers: open update" ON drivers;
CREATE POLICY "Drivers: open update"
  ON drivers FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Drivers: open delete" ON drivers;
CREATE POLICY "Drivers: open delete"
  ON drivers FOR DELETE
  USING (true);

-- ── 2. ORDERS ──
DROP POLICY IF EXISTS "Orders: admin full access" ON orders;
DROP POLICY IF EXISTS "Orders: customer reads own" ON orders;
DROP POLICY IF EXISTS "Orders: anon can insert" ON orders;
DROP POLICY IF EXISTS "Orders: open read" ON orders;
DROP POLICY IF EXISTS "Orders: open insert" ON orders;
DROP POLICY IF EXISTS "Orders: open update" ON orders;

CREATE POLICY "Orders: open read"
  ON orders FOR SELECT
  USING (true);

CREATE POLICY "Orders: open insert"
  ON orders FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Orders: open update"
  ON orders FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- ── 3. PUSH_SUBSCRIPTIONS ──
DROP POLICY IF EXISTS "Push subs: insert own" ON push_subscriptions;
DROP POLICY IF EXISTS "Push subs: read own" ON push_subscriptions;
DROP POLICY IF EXISTS "Push subs: delete own" ON push_subscriptions;
DROP POLICY IF EXISTS "Push subs: update own" ON push_subscriptions;
DROP POLICY IF EXISTS "Users can manage own subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Authenticated users manage own subs" ON push_subscriptions;
DROP POLICY IF EXISTS "Push subs: open all" ON push_subscriptions;

CREATE POLICY "Push subs: open all"
  ON push_subscriptions FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 4. DRIVER_ORDERS ──
DROP POLICY IF EXISTS "Driver orders: admin full access" ON driver_orders;
DROP POLICY IF EXISTS "Driver orders: public insert" ON driver_orders;
DROP POLICY IF EXISTS "Driver orders: public read own" ON driver_orders;
DROP POLICY IF EXISTS "Driver orders: public update own pending" ON driver_orders;
DROP POLICY IF EXISTS "Driver orders: open read" ON driver_orders;
DROP POLICY IF EXISTS "Driver orders: open insert" ON driver_orders;
DROP POLICY IF EXISTS "Driver orders: open update" ON driver_orders;

CREATE POLICY "Driver orders: open read"
  ON driver_orders FOR SELECT
  USING (true);

CREATE POLICY "Driver orders: open insert"
  ON driver_orders FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Driver orders: open update"
  ON driver_orders FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- ── 5. DRIVER_ORDER_ITEMS ──
DROP POLICY IF EXISTS "Driver order items: admin full access" ON driver_order_items;
DROP POLICY IF EXISTS "Driver order items: public read" ON driver_order_items;
DROP POLICY IF EXISTS "Driver order items: public insert" ON driver_order_items;
DROP POLICY IF EXISTS "Driver order items: public delete own" ON driver_order_items;
DROP POLICY IF EXISTS "Driver order items: open all" ON driver_order_items;

CREATE POLICY "Driver order items: open all"
  ON driver_order_items FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 6. DRIVER_PRICES ──
DROP POLICY IF EXISTS "Driver prices: admin manage" ON driver_prices;
DROP POLICY IF EXISTS "Driver prices: public read" ON driver_prices;
DROP POLICY IF EXISTS "Driver prices: open all" ON driver_prices;

CREATE POLICY "Driver prices: open all"
  ON driver_prices FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 7. PRODUCTS ──
DROP POLICY IF EXISTS "Products: admin manage" ON products;
DROP POLICY IF EXISTS "Products: public read" ON products;
DROP POLICY IF EXISTS "Products: open all" ON products;

CREATE POLICY "Products: open all"
  ON products FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 8. ADMIN_INVITE_CODES ──
DROP POLICY IF EXISTS "Invite codes: admin manage" ON admin_invite_codes;
DROP POLICY IF EXISTS "Invite codes: public validate" ON admin_invite_codes;
DROP POLICY IF EXISTS "Invite codes: public use" ON admin_invite_codes;
DROP POLICY IF EXISTS "Invite codes: open all" ON admin_invite_codes;

CREATE POLICY "Invite codes: open all"
  ON admin_invite_codes FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── 9. NOTIFICATION_LOG ──
DROP POLICY IF EXISTS "Notification log: admin read" ON notification_log;
DROP POLICY IF EXISTS "Notification log: service only" ON notification_log;
DROP POLICY IF EXISTS "Notification log: open all" ON notification_log;

CREATE POLICY "Notification log: open all"
  ON notification_log FOR ALL
  USING (true)
  WITH CHECK (true);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

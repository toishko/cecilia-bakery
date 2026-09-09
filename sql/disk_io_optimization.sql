-- ═══════════════════════════════════════════════════════════════════
-- CECILIA BAKERY: SUPABASE DISK IO & HIGH PERFORMANCE INDEXES
-- Run this in the Supabase Dashboard -> SQL Editor (https://supabase.com)
-- ═══════════════════════════════════════════════════════════════════

-- 1. DRIVER ORDERS: High-traffic queries by status, driver, and date
CREATE INDEX IF NOT EXISTS idx_driver_orders_status_submitted 
  ON public.driver_orders (status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_driver_orders_driver_submitted 
  ON public.driver_orders (driver_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_driver_orders_submitted_at_desc 
  ON public.driver_orders (submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_driver_orders_batch_id 
  ON public.driver_orders (batch_id);

-- 2. DRIVER ORDER ITEMS: Foreign key joins and order item lookups
CREATE INDEX IF NOT EXISTS idx_driver_order_items_order_id 
  ON public.driver_order_items (order_id);

-- 3. DRIVER PRICES: Driver price lookups on order submit & product load
CREATE INDEX IF NOT EXISTS idx_driver_prices_driver_product 
  ON public.driver_prices (driver_id, product_key);

-- 4. PROFILES: Fast Clerk login & auth resolution
CREATE INDEX IF NOT EXISTS idx_profiles_clerk_user_id 
  ON public.profiles (clerk_user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_email 
  ON public.profiles (email);

-- 5. NOTIFICATION LOG: Speed up idempotency & cleanup checks
CREATE INDEX IF NOT EXISTS idx_notification_log_created_at 
  ON public.notification_log (created_at DESC);

-- 6. AI USAGE LOGS: Admin insights & cost monitoring
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at 
  ON public.ai_usage_logs (created_at DESC);

-- 7. VACUUM & ANALYZE: Reclaim disk space and refresh query planner statistics
VACUUM (ANALYZE) public.driver_orders;
VACUUM (ANALYZE) public.driver_order_items;
VACUUM (ANALYZE) public.driver_prices;
VACUUM (ANALYZE) public.profiles;
VACUUM (ANALYZE) public.notification_log;

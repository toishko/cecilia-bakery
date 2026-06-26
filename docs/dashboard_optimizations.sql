-- ═══════════════════════════════════════════════════════════════
-- CECILIA BAKERY: DASHBOARD PERFORMANCE OPTIMIZATIONS
-- Run this script in the Supabase SQL Editor (https://supabase.com)
-- to create the required RPC functions and database indexes.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. DATABASE INDEXES ──
-- Optimizes date and status filtering to prevent full table scans

-- Index on driver_sales for driver-specific dashboards and date ranges
CREATE INDEX IF NOT EXISTS idx_driver_sales_driver_date 
  ON driver_sales (driver_id, created_at DESC);

-- Index on driver_sale_items foreign key for fast joins
CREATE INDEX IF NOT EXISTS idx_driver_sale_items_sale_id 
  ON driver_sale_items (sale_id);

-- Index on wholesale_orders for date-range queries
CREATE INDEX IF NOT EXISTS idx_wholesale_orders_placed_status 
  ON wholesale_orders (placed_at DESC, status);

-- Index on storefront orders for source + date queries
CREATE INDEX IF NOT EXISTS idx_orders_source_date 
  ON orders (source, created_at DESC);


-- ── 2. ADMIN DASHBOARD STATS RPC ──
-- Pre-calculates gross, collected, and outstanding revenue across all three channels
CREATE OR REPLACE FUNCTION get_admin_dashboard_stats(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_driver_gross numeric := 0;
  v_driver_collected numeric := 0;
  v_driver_outstanding numeric := 0;
  
  v_wholesale_gross numeric := 0;
  v_wholesale_collected numeric := 0;
  v_wholesale_outstanding numeric := 0;
  
  v_online_gross numeric := 0;
  v_online_collected numeric := 0;
BEGIN
  -- Driver Orders
  SELECT 
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(payment_amount), 0),
    COALESCE(SUM(CASE WHEN payment_status IN ('not_paid', 'partial') THEN GREATEST(0, total_amount - payment_amount) ELSE 0 END), 0)
  INTO v_driver_gross, v_driver_collected, v_driver_outstanding
  FROM driver_orders
  WHERE (p_start_date IS NULL OR submitted_at >= p_start_date)
    AND submitted_at <= p_end_date;

  -- Wholesale Orders
  SELECT 
    COALESCE(SUM(subtotal), 0),
    COALESCE(SUM(CASE WHEN status = 'delivered' THEN subtotal ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status IN ('confirmed', 'scheduled') THEN subtotal ELSE 0 END), 0)
  INTO v_wholesale_gross, v_wholesale_collected, v_wholesale_outstanding
  FROM wholesale_orders
  WHERE (p_start_date IS NULL OR placed_at >= p_start_date)
    AND placed_at <= p_end_date;

  -- Online Orders
  SELECT 
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(CASE WHEN delivery_status != 'cancelled' THEN total_amount ELSE 0 END), 0)
  INTO v_online_gross, v_online_collected
  FROM orders
  WHERE source = 'website'
    AND (p_start_date IS NULL OR created_at >= p_start_date)
    AND created_at <= p_end_date;

  RETURN json_build_object(
    'driverGross', v_driver_gross,
    'driverCollected', v_driver_collected,
    'driverOutstanding', v_driver_outstanding,
    'wholesaleGross', v_wholesale_gross,
    'wholesaleCollected', v_wholesale_collected,
    'wholesaleOutstanding', v_wholesale_outstanding,
    'onlineGross', v_online_gross,
    'onlineCollected', v_online_collected,
    'totalGross', v_driver_gross + v_wholesale_gross + v_online_gross,
    'totalCollected', v_driver_collected + v_wholesale_collected + v_online_collected,
    'totalOutstanding', v_driver_outstanding + v_wholesale_outstanding
  );
END;
$$;


-- ── 3. ADMIN CHART BUCKETS RPC ──
-- Returns daily or monthly aggregated revenue groups
CREATE OR REPLACE FUNCTION get_admin_chart_buckets(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_use_monthly boolean
)
RETURNS TABLE (
  bucket_key text,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
#variable_conflict use_column
BEGIN
  IF p_use_monthly THEN
    RETURN QUERY
    WITH combined AS (
      SELECT o.submitted_at::timestamptz as dt, o.total_amount as amt FROM driver_orders o WHERE (p_start_date IS NULL OR o.submitted_at >= p_start_date) AND o.submitted_at <= p_end_date
      UNION ALL
      SELECT w.placed_at::timestamptz as dt, w.subtotal as amt FROM wholesale_orders w WHERE (p_start_date IS NULL OR w.placed_at >= p_start_date) AND w.placed_at <= p_end_date
      UNION ALL
      SELECT r.created_at::timestamptz as dt, r.total_amount as amt FROM orders r WHERE r.source = 'website' AND (p_start_date IS NULL OR r.created_at >= p_start_date) AND r.created_at <= p_end_date
    )
    SELECT 
      to_char(dt, 'YYYY-MM') as b_key,
      SUM(amt)::numeric as tot
    FROM combined
    GROUP BY b_key
    ORDER BY b_key;
  ELSE
    RETURN QUERY
    WITH combined AS (
      SELECT o.submitted_at::timestamptz as dt, o.total_amount as amt FROM driver_orders o WHERE (p_start_date IS NULL OR o.submitted_at >= p_start_date) AND o.submitted_at <= p_end_date
      UNION ALL
      SELECT w.placed_at::timestamptz as dt, w.subtotal as amt FROM wholesale_orders w WHERE (p_start_date IS NULL OR w.placed_at >= p_start_date) AND w.placed_at <= p_end_date
      UNION ALL
      SELECT r.created_at::timestamptz as dt, r.total_amount as amt FROM orders r WHERE r.source = 'website' AND (p_start_date IS NULL OR r.created_at >= p_start_date) AND r.created_at <= p_end_date
    )
    SELECT 
      to_char(dt, 'YYYY-MM-DD') as b_key,
      SUM(amt)::numeric as tot
    FROM combined
    GROUP BY b_key
    ORDER BY b_key;
  END IF;
END;
$$;


-- ── 4. DRIVER LEADERBOARD RPC ──
-- Ranks drivers by total orders volume in the timeframe
CREATE OR REPLACE FUNCTION get_driver_leaderboard(
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (
  driver_id uuid,
  driver_name text,
  amount numeric,
  order_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.id as driver_id,
    d.name as driver_name,
    COALESCE(SUM(o.total_amount), 0)::numeric as amount,
    COUNT(o.id) as order_count
  FROM drivers d
  JOIN driver_orders o ON o.driver_id = d.id
  WHERE (p_start_date IS NULL OR o.submitted_at >= p_start_date)
    AND o.submitted_at <= p_end_date
  GROUP BY d.id, d.name
  ORDER BY amount DESC;
END;
$$;


-- ── 5. DRIVER DASHBOARD STATS RPC ──
-- Summarizes sales, chart buckets, best sellers, and top clients for a driver
CREATE OR REPLACE FUNCTION get_driver_dashboard_stats(
  p_driver_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_use_monthly boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_sales bigint := 0;
  v_total_revenue numeric := 0;
  v_total_items_sold bigint := 0;
  
  v_summary json;
  v_chart json;
  v_best_sellers json;
  v_top_clients json;
BEGIN
  -- 1. Summary Metrics
  SELECT 
    COUNT(s.id),
    COALESCE(SUM(s.total), 0)
  INTO v_total_sales, v_total_revenue
  FROM driver_sales s
  WHERE s.driver_id = p_driver_id
    AND (p_start_date IS NULL OR s.created_at >= p_start_date)
    AND s.created_at <= p_end_date;

  SELECT 
    COALESCE(SUM(si.quantity), 0)
  INTO v_total_items_sold
  FROM driver_sales s
  JOIN driver_sale_items si ON si.sale_id = s.id
  WHERE s.driver_id = p_driver_id
    AND (p_start_date IS NULL OR s.created_at >= p_start_date)
    AND s.created_at <= p_end_date;

  v_summary := json_build_object(
    'total_sales', v_total_sales,
    'total_revenue', v_total_revenue,
    'total_items_sold', v_total_items_sold
  );

  -- 2. Chart Buckets
  IF p_use_monthly THEN
    SELECT COALESCE(json_agg(t), '[]'::json) INTO v_chart
    FROM (
      SELECT 
        to_char(s.created_at, 'YYYY-MM') as bucket_key,
        SUM(s.total)::numeric as total_amount
      FROM driver_sales s
      WHERE s.driver_id = p_driver_id
        AND (p_start_date IS NULL OR s.created_at >= p_start_date)
        AND s.created_at <= p_end_date
      GROUP BY bucket_key
      ORDER BY bucket_key
    ) t;
  ELSE
    SELECT COALESCE(json_agg(t), '[]'::json) INTO v_chart
    FROM (
      SELECT 
        to_char(s.created_at, 'YYYY-MM-DD') as bucket_key,
        SUM(s.total)::numeric as total_amount
      FROM driver_sales s
      WHERE s.driver_id = p_driver_id
        AND (p_start_date IS NULL OR s.created_at >= p_start_date)
        AND s.created_at <= p_end_date
      GROUP BY bucket_key
      ORDER BY bucket_key
    ) t;
  END IF;

  -- 3. Best Sellers (top 8)
  SELECT COALESCE(json_agg(t), '[]'::json) INTO v_best_sellers
  FROM (
    SELECT 
      si.product_key,
      si.product_label,
      SUM(si.quantity)::bigint as qty,
      SUM(si.line_total)::numeric as revenue
    FROM driver_sales s
    JOIN driver_sale_items si ON si.sale_id = s.id
    WHERE s.driver_id = p_driver_id
      AND (p_start_date IS NULL OR s.created_at >= p_start_date)
      AND s.created_at <= p_end_date
    GROUP BY si.product_key, si.product_label
    ORDER BY qty DESC
    LIMIT 8
  ) t;

  -- 4. Top Clients (top 8)
  SELECT COALESCE(json_agg(t), '[]'::json) INTO v_top_clients
  FROM (
    SELECT 
      s.client_id,
      SUM(s.total)::numeric as total,
      COUNT(s.id) as count
    FROM driver_sales s
    WHERE s.driver_id = p_driver_id
      AND s.client_id IS NOT NULL
      AND (p_start_date IS NULL OR s.created_at >= p_start_date)
      AND s.created_at <= p_end_date
    GROUP BY s.client_id
    ORDER BY total DESC
    LIMIT 8
  ) t;

  RETURN json_build_object(
    'summary', v_summary,
    'chart', v_chart,
    'best_sellers', v_best_sellers,
    'top_clients', v_top_clients
  );
END;
$$;


-- ── 6. SECURITY: ENABLE RLS ON LEGACY BACKUP TABLES ──
-- Ensures backup tables are secured and do not trigger public access alerts
ALTER TABLE IF EXISTS public.drivers_old ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.driver_prices_old ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.driver_order_items_old ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════
-- Cecilia Bakery — Delete Orders #588 and #589 (Topal)
-- Executed on 2026-08-24
-- ═══════════════════════════════════════════════════════════════════

-- 1. Delete associated order items
DELETE FROM driver_order_items
WHERE order_id IN (
    SELECT id FROM driver_orders WHERE order_number IN (588, 589)
);

-- 2. Delete the order headers
DELETE FROM driver_orders
WHERE order_number IN (588, 589);

-- 3. Verify deletion
SELECT * FROM driver_orders WHERE order_number IN (588, 589);

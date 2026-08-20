-- ═══════════════════════════════════════════════════════════════════
-- Cecilia Bakery — Delete Order #585 (Placed by mistake)
-- Executed on 2026-08-20
-- ═══════════════════════════════════════════════════════════════════

-- 1. Delete associated order items
DELETE FROM driver_order_items
WHERE order_id IN (
    SELECT id FROM driver_orders WHERE order_number = 585
);

-- 2. Delete the order header
DELETE FROM driver_orders
WHERE order_number = 585;

-- 3. Verify deletion
SELECT * FROM driver_orders WHERE order_number = 585;

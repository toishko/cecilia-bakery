-- ═══════════════════════════════════════════════════════════════════
-- Cecilia Bakery — Archive Orders #530, #527, #525, #524, #522, #521
-- Run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- 1. Create a persistent backup snapshot table if it doesn't already exist
CREATE TABLE IF NOT EXISTS driver_orders_backup_snapshot (LIKE driver_orders INCLUDING ALL);

-- 2. Insert snapshot copies of the target orders before archiving (safe ignore if already backed up)
INSERT INTO driver_orders_backup_snapshot
SELECT * FROM driver_orders
WHERE order_number IN (530, 527, 525, 524, 522, 521)
ON CONFLICT (id) DO NOTHING;

-- 3. Mark the orders as 'archived' (preserves all items, prices, driver references)
UPDATE driver_orders
SET status = 'archived'
WHERE order_number IN (530, 527, 525, 524, 522, 521);

-- 4. Verify results
SELECT id, order_number, driver_id, status, payment_status, total_amount, submitted_at
FROM driver_orders
WHERE order_number IN (530, 527, 525, 524, 522, 521)
ORDER BY order_number DESC;

-- ═══════════════════════════════════════════════════════════════════
-- HOW TO RESTORE (If you ever need to bring them back):
--
-- UPDATE driver_orders
-- SET status = 'pending'
-- WHERE order_number IN (530, 527, 525, 524, 522, 521);
--
-- OR restore a specific order by number:
-- UPDATE driver_orders SET status = 'pending' WHERE order_number = 530;
-- ═══════════════════════════════════════════════════════════════════

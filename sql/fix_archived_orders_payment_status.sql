-- ═══════════════════════════════════════════════════════════════════
-- Cecilia Bakery — Settle Payment Status on Archived Orders
-- Orders: #659, #599, #530, #527, #525, #524, #522, #521
--
-- Why: When orders are superseded, cancelled, or archived, leaving
-- payment_status as 'not_paid' causes ghost balances in driver balance
-- banners, the "Unpaid" orders tab, and admin driver tables.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Update archived orders so their outstanding balance is zeroed
UPDATE driver_orders
SET
  payment_status = 'paid',
  payment_amount = total_amount
WHERE status = 'archived'
  AND order_number IN (659, 599, 530, 527, 525, 524, 522, 521);

-- 2. Verify all archived orders now have zero balance
SELECT id, order_number, driver_id, status, payment_status, payment_amount, total_amount, pickup_date
FROM driver_orders
WHERE status = 'archived'
ORDER BY order_number DESC;

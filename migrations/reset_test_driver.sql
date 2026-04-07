-- ═══════════════════════════════════════════════════════════
--  PURGE ALL TEST DRIVER DATA
--  Test Driver ID: 8925b9c1-ba85-4ba1-8275-2ee24b3e814e
--  Run this in the Supabase SQL Editor
--  Only the test driver's data is affected — no other drivers.
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  v_driver_id UUID := '8925b9c1-ba85-4ba1-8275-2ee24b3e814e';
BEGIN

  -- 1. Delete sale items linked to the test driver's sales
  DELETE FROM driver_sale_items
  WHERE sale_id IN (
    SELECT id FROM driver_sales
    WHERE driver_id = v_driver_id
  );

  -- 2. Delete the sales themselves
  DELETE FROM driver_sales
  WHERE driver_id = v_driver_id;

  -- 3. Delete order items linked to the test driver's orders
  DELETE FROM driver_order_items
  WHERE order_id IN (
    SELECT id FROM driver_orders
    WHERE driver_id = v_driver_id
  );

  -- 4. Delete the orders themselves
  DELETE FROM driver_orders
  WHERE driver_id = v_driver_id;

  -- 5. Delete manual inventory loads for the test driver
  DELETE FROM driver_inventory
  WHERE driver_id = v_driver_id;

  RAISE NOTICE 'Test driver data purged successfully.';
END $$;

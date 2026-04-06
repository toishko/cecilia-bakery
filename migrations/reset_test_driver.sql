-- Reset inventory/sales for Test Driver (ID: 8925b9c1-ba85-4ba1-8275-2ee24b3e814e)
-- Run this in the Supabase SQL Editor

-- Delete all sales
DELETE FROM driver_sales 
WHERE driver_id = '8925b9c1-ba85-4ba1-8275-2ee24b3e814e';

-- Delete all order items associated with their orders
DELETE FROM driver_order_items 
WHERE order_id IN (
    SELECT id FROM driver_orders 
    WHERE driver_id = '8925b9c1-ba85-4ba1-8275-2ee24b3e814e'
);

-- Delete the orders themselves
DELETE FROM driver_orders 
WHERE driver_id = '8925b9c1-ba85-4ba1-8275-2ee24b3e814e';

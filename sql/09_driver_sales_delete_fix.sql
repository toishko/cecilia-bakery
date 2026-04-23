DROP POLICY IF EXISTS "Drivers can delete their own sales" ON driver_sales;
DROP POLICY IF EXISTS "Drivers can delete their own sale items" ON driver_sale_items;

CREATE POLICY "Drivers can delete sales"
ON driver_sales FOR DELETE
USING (true);

CREATE POLICY "Drivers can delete sale items"
ON driver_sale_items FOR DELETE
USING (true);

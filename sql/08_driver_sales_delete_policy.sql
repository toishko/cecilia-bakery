-- Create policy to allow drivers to delete their own sales
CREATE POLICY "Drivers can delete their own sales"
ON driver_sales FOR DELETE
USING (driver_id = auth.uid());

-- Create policy to allow drivers to delete their own sale items
CREATE POLICY "Drivers can delete their own sale items"
ON driver_sale_items FOR DELETE
USING (EXISTS (
  SELECT 1 FROM driver_sales 
  WHERE id = driver_sale_items.sale_id 
  AND driver_id = auth.uid()
));

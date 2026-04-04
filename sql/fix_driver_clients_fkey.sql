-- Fix for driver_route_clients foreign key violation

-- 1. Drop the incorrect foreign key constraint pointing to auth.users or profiles
ALTER TABLE public.driver_route_clients
DROP CONSTRAINT IF EXISTS driver_route_clients_driver_id_fkey;

-- 2. Add the correct foreign key constraint pointing to the drivers table
ALTER TABLE public.driver_route_clients
ADD CONSTRAINT driver_route_clients_driver_id_fkey
FOREIGN KEY (driver_id)
REFERENCES public.drivers(id)
ON DELETE CASCADE;

-- Note: The ON DELETE CASCADE ensures that if a driver is deleted, 
-- their route clients are automatically cleaned up to prevent orphaned records.

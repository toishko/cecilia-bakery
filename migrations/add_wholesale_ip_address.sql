-- Add ip_address column to wholesale_accounts for bot tracking
-- Run this in Supabase SQL Editor

ALTER TABLE wholesale_accounts
ADD COLUMN IF NOT EXISTS ip_address text;

-- Optional: add a comment for documentation
COMMENT ON COLUMN wholesale_accounts.ip_address IS 'Client IP address captured at application submission for bot detection';

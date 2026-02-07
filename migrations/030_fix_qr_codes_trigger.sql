-- Migration: Fix qr_codes trigger issue
-- Description: Remove problematic updated_at trigger for qr_codes table

-- Drop the trigger that tries to use updated_at column that doesn't exist
DROP TRIGGER IF EXISTS update_qr_codes_updated_at ON qr_codes;

-- Comment explaining the fix
COMMENT ON TABLE qr_codes IS 'QR codes table - updated_at trigger removed to fix sync issues';

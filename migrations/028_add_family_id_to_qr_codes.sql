-- ============================================================================
-- Migration: 028_add_family_id_to_qr_codes.sql
-- Description: Add family_id column to qr_codes table for family QR codes
-- Author: Claude Code
-- Date: 2026-02-07
-- ============================================================================

-- Add family_id column to qr_codes table
ALTER TABLE qr_codes 
ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id) ON DELETE CASCADE;

-- Add invited_count column for family QR codes
ALTER TABLE qr_codes 
ADD COLUMN IF NOT EXISTS invited_count INTEGER DEFAULT 1;

-- Add index for family_id lookups
CREATE INDEX IF NOT EXISTS idx_qr_codes_family_id ON qr_codes(family_id) WHERE family_id IS NOT NULL;

-- Add index for efficient family QR code lookups
CREATE INDEX IF NOT EXISTS idx_qr_codes_event_family ON qr_codes(event_id, family_id) WHERE family_id IS NOT NULL;

-- Add constraint to ensure QR codes have either guest_id OR family_id but not both
ALTER TABLE qr_codes 
ADD CONSTRAINT IF NOT EXISTS chk_qr_codes_guest_or_family 
CHECK ((guest_id IS NOT NULL AND family_id IS NULL) OR (guest_id IS NULL AND family_id IS NOT NULL));

-- Update documentation
COMMENT ON COLUMN qr_codes.family_id IS 'Reference to family for family-based QR codes';
COMMENT ON COLUMN qr_codes.invited_count IS 'Number of people invited with this family QR code';
COMMENT ON INDEX idx_qr_codes_family_id IS 'Index for family QR code lookups';
COMMENT ON INDEX idx_qr_codes_event_family IS 'Index for event-family QR code queries';
-- Migration: Add is_active column to guests table
-- Description: Required for dashboard optimizations

-- Add is_active column to guests table
ALTER TABLE guests ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_guests_is_active ON guests(is_active);

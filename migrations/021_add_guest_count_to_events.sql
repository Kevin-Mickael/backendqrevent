-- Migration: Add guest_count column to events table
-- Date: 2026-02-07

-- Add guest_count column to events table
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS guest_count INTEGER CHECK (guest_count >= 1 AND guest_count <= 1000);

-- Make description optional (nullable)
ALTER TABLE events 
ALTER COLUMN description DROP NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN events.guest_count IS 'Number of invited guests for the event estimation';

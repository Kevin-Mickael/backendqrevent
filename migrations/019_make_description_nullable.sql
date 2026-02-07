-- Migration: Make description column nullable in events table
-- Description: Allow events to be created without description

ALTER TABLE events 
ALTER COLUMN description DROP NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN events.description IS 'Event description (optional)';

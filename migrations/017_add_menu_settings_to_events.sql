-- Migration: Add menu settings to events table
-- Description: Add column to store menu visibility settings for each event

-- Add menu_settings column to events table
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS menu_settings JSONB DEFAULT '{
  "message": true,
  "histoire": true,
  "invitation": true,
  "table": false,
  "game": true,
  "avis": true
}'::jsonb;

-- Create index for menu_settings queries
CREATE INDEX IF NOT EXISTS idx_events_menu_settings ON events USING GIN (menu_settings);

-- Update existing events to have default menu settings if null
UPDATE events 
SET menu_settings = '{
  "message": true,
  "histoire": true,
  "invitation": true,
  "table": false,
  "game": true,
  "avis": true
}'::jsonb 
WHERE menu_settings IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN events.menu_settings IS 'JSON object storing menu visibility settings for guest interface';
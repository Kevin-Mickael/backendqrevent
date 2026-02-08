-- Migration 031: Add simple event schedule support
-- Simple approach: just add event_schedule column

DO $$ 
BEGIN
  -- Add event_schedule column to store the program steps
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'event_schedule'
  ) THEN
    ALTER TABLE events ADD COLUMN event_schedule JSONB DEFAULT '[]';
    RAISE NOTICE 'Added event_schedule column';
  ELSE
    RAISE NOTICE 'Column event_schedule already exists';
  END IF;

  -- Add index for performance on schedule queries
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'events' 
    AND indexname = 'idx_events_schedule'
  ) THEN
    CREATE INDEX idx_events_schedule ON events USING GIN (event_schedule);
    RAISE NOTICE 'Created index on event_schedule';
  ELSE
    RAISE NOTICE 'Index idx_events_schedule already exists';
  END IF;

END $$;

-- Set default schedule for existing events
UPDATE events 
SET event_schedule = '[
  {"id": "1", "name": "Cérémonie", "location": "", "time": "14:00"},
  {"id": "2", "name": "Réception", "location": "", "time": "18:00"}
]'::jsonb
WHERE event_schedule = '[]' OR event_schedule IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN events.event_schedule IS 'JSONB array containing event schedule steps: [{"id": "1", "name": "Cérémonie", "location": "Église", "time": "14:00"}]';
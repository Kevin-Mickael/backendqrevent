-- Migration 032: Add partner names and ensure event schedule is properly configured
-- Adds partner1_name, partner2_name, and ensures event_schedule column exists

DO $$ 
BEGIN
  -- Add partner names columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'partner1_name'
  ) THEN
    ALTER TABLE events ADD COLUMN partner1_name VARCHAR(100);
    RAISE NOTICE 'Added partner1_name column';
  ELSE
    RAISE NOTICE 'Column partner1_name already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'partner2_name'
  ) THEN
    ALTER TABLE events ADD COLUMN partner2_name VARCHAR(100);
    RAISE NOTICE 'Added partner2_name column';
  ELSE
    RAISE NOTICE 'Column partner2_name already exists';
  END IF;

  -- Ensure event_schedule column exists
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

  -- Add indexes for partner names
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'events' 
    AND indexname = 'idx_events_partner1_name'
  ) THEN
    CREATE INDEX idx_events_partner1_name ON events(partner1_name);
    RAISE NOTICE 'Created index on partner1_name';
  ELSE
    RAISE NOTICE 'Index idx_events_partner1_name already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'events' 
    AND indexname = 'idx_events_partner2_name'
  ) THEN
    CREATE INDEX idx_events_partner2_name ON events(partner2_name);
    RAISE NOTICE 'Created index on partner2_name';
  ELSE
    RAISE NOTICE 'Index idx_events_partner2_name already exists';
  END IF;

END $$;

-- Set default schedule for existing events that don't have one
UPDATE events 
SET event_schedule = '[
  {"id": "1", "name": "Cérémonie", "location": "", "time": "14:00"},
  {"id": "2", "name": "Réception", "location": "", "time": "18:00"}
]'::jsonb
WHERE event_schedule = '[]' OR event_schedule IS NULL;

-- Migrate existing bride_name and groom_name to new partner fields if they exist
DO $$
BEGIN
  -- Check if bride_name column exists and migrate data
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'bride_name'
  ) THEN
    UPDATE events 
    SET partner2_name = bride_name 
    WHERE bride_name IS NOT NULL AND partner2_name IS NULL;
    
    RAISE NOTICE 'Migrated bride_name to partner2_name';
  END IF;

  -- Check if groom_name column exists and migrate data
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'groom_name'
  ) THEN
    UPDATE events 
    SET partner1_name = groom_name 
    WHERE groom_name IS NOT NULL AND partner1_name IS NULL;
    
    RAISE NOTICE 'Migrated groom_name to partner1_name';
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON COLUMN events.partner1_name IS 'Nom du premier partenaire (marié)';
COMMENT ON COLUMN events.partner2_name IS 'Nom du second partenaire (mariée)';
COMMENT ON COLUMN events.event_schedule IS 'JSONB array containing event schedule steps: [{"id": "1", "name": "Cérémonie", "location": "Église", "time": "14:00"}]';
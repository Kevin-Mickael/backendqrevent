-- Migration 033: Simple add columns (without validation conflicts)
-- Adds partner1_name, partner2_name, and event_schedule columns

-- Add partner1_name column
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'partner1_name'
  ) THEN
    ALTER TABLE events ADD COLUMN partner1_name VARCHAR(100);
  END IF;
END $$;

-- Add partner2_name column
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'partner2_name'
  ) THEN
    ALTER TABLE events ADD COLUMN partner2_name VARCHAR(100);
  END IF;
END $$;

-- Add event_schedule column
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'event_schedule'
  ) THEN
    ALTER TABLE events ADD COLUMN event_schedule JSONB DEFAULT '[]';
  END IF;
END $$;

-- Create indexes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_events_schedule') THEN
    CREATE INDEX idx_events_schedule ON events USING GIN (event_schedule);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_events_partner1') THEN
    CREATE INDEX idx_events_partner1 ON events(partner1_name);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_events_partner2') THEN
    CREATE INDEX idx_events_partner2 ON events(partner2_name);
  END IF;
END $$;
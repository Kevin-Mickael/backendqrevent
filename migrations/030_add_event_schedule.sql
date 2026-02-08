-- Migration 030: Add simple event schedule support
-- Replaces complex venue system with simple event schedule steps

DO $$ 
BEGIN
  -- Add event_schedule column to store the program steps
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'event_schedule'
  ) THEN
    ALTER TABLE events ADD COLUMN event_schedule JSONB DEFAULT '[]';
  END IF;

  -- Add index for performance on schedule queries
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'events' 
    AND indexname = 'idx_events_schedule'
  ) THEN
    CREATE INDEX idx_events_schedule ON events USING GIN (event_schedule);
  END IF;

END $$;

-- Create function to migrate existing venue data to schedule format
CREATE OR REPLACE FUNCTION migrate_venues_to_schedule()
RETURNS void AS $$
BEGIN
  -- Convert existing venue data to simple schedule format
  UPDATE events 
  SET event_schedule = (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'name', step_name,
        'location', step_location,
        'time', step_time
      )
    )
    FROM (
      VALUES 
        ('Cérémonie', 
         COALESCE(ceremony_venue->>'name', ceremony_venue->>'address', location->>'address', 'Lieu non défini'),
         COALESCE(ceremony_time::text, '14:00')),
        ('Réception',
         COALESCE(reception_venue->>'name', reception_venue->>'address', ceremony_venue->>'address', location->>'address', 'Lieu non défini'),
         COALESCE(reception_time::text, '18:00'))
    ) AS schedule_data(step_name, step_location, step_time)
    WHERE step_location != 'Lieu non défini' OR step_name = 'Cérémonie'
  )
  WHERE event_schedule = '[]' 
  AND (ceremony_venue IS NOT NULL OR location IS NOT NULL);

  -- For events without venue data, set default schedule
  UPDATE events 
  SET event_schedule = '[
    {"id": "1", "name": "Cérémonie", "location": "", "time": "14:00"},
    {"id": "2", "name": "Réception", "location": "", "time": "18:00"}
  ]'::jsonb
  WHERE event_schedule = '[]';

  RAISE NOTICE 'Migrated % events to new schedule format', 
    (SELECT COUNT(*) FROM events WHERE event_schedule != '[]');
END;
$$ LANGUAGE plpgsql;

-- Execute the migration
SELECT migrate_venues_to_schedule();

-- Add validation function for schedule
CREATE OR REPLACE FUNCTION validate_event_schedule()
RETURNS trigger AS $$
BEGIN
  -- Validate that schedule is a proper JSON array
  IF NEW.event_schedule IS NOT NULL THEN
    -- Check if it's an array
    IF jsonb_typeof(NEW.event_schedule) != 'array' THEN
      RAISE EXCEPTION 'event_schedule must be a JSON array';
    END IF;
    
    -- Validate each schedule item has required fields
    IF EXISTS (
      SELECT 1 
      FROM jsonb_array_elements(NEW.event_schedule) as schedule_item
      WHERE NOT (schedule_item ? 'name' AND schedule_item ? 'location' AND schedule_item ? 'time')
    ) THEN
      RAISE EXCEPTION 'Each schedule item must have name, location, and time fields';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for schedule validation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'validate_event_schedule_trigger'
  ) THEN
    CREATE TRIGGER validate_event_schedule_trigger
      BEFORE INSERT OR UPDATE ON events
      FOR EACH ROW EXECUTE FUNCTION validate_event_schedule();
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN events.event_schedule IS 'JSONB array containing event schedule steps: [{"id": "1", "name": "Cérémonie", "location": "Église", "time": "14:00"}]';

-- Clean up old venue columns (optional - comment out if you want to keep them)
/*
DO $$
BEGIN
  -- Remove old venue columns if they exist
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'ceremony_venue') THEN
    ALTER TABLE events DROP COLUMN IF EXISTS ceremony_venue;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'reception_venue') THEN
    ALTER TABLE events DROP COLUMN IF EXISTS reception_venue;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'ceremony_date') THEN
    ALTER TABLE events DROP COLUMN IF EXISTS ceremony_date;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'ceremony_time') THEN
    ALTER TABLE events DROP COLUMN IF EXISTS ceremony_time;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'reception_date') THEN
    ALTER TABLE events DROP COLUMN IF EXISTS reception_date;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'reception_time') THEN
    ALTER TABLE events DROP COLUMN IF EXISTS reception_time;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'venue_type') THEN
    ALTER TABLE events DROP COLUMN IF EXISTS venue_type;
  END IF;
END $$;
*/
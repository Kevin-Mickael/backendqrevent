-- Migration 029: Add ceremony and reception venues support
-- Enhances the events table to support separate venues for ceremony and reception

DO $$ 
BEGIN
  -- Add new columns for ceremony and reception venues
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'ceremony_venue'
  ) THEN
    ALTER TABLE events ADD COLUMN ceremony_venue JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'reception_venue'
  ) THEN
    ALTER TABLE events ADD COLUMN reception_venue JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'ceremony_date'
  ) THEN
    ALTER TABLE events ADD COLUMN ceremony_date DATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'ceremony_time'
  ) THEN
    ALTER TABLE events ADD COLUMN ceremony_time TIME;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'reception_date'
  ) THEN
    ALTER TABLE events ADD COLUMN reception_date DATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'reception_time'
  ) THEN
    ALTER TABLE events ADD COLUMN reception_time TIME;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' 
    AND column_name = 'venue_type'
  ) THEN
    ALTER TABLE events ADD COLUMN venue_type VARCHAR(20) DEFAULT 'single' 
    CHECK (venue_type IN ('single', 'separate'));
  END IF;

  -- Add indexes for performance
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'events' 
    AND indexname = 'idx_events_ceremony_date'
  ) THEN
    CREATE INDEX idx_events_ceremony_date ON events(ceremony_date);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'events' 
    AND indexname = 'idx_events_reception_date'
  ) THEN
    CREATE INDEX idx_events_reception_date ON events(reception_date);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'events' 
    AND indexname = 'idx_events_venue_type'
  ) THEN
    CREATE INDEX idx_events_venue_type ON events(venue_type);
  END IF;

END $$;

-- Create a function to migrate existing events to new structure
CREATE OR REPLACE FUNCTION migrate_existing_events_to_venues()
RETURNS void AS $$
BEGIN
  -- Update existing events to use the new structure
  -- If they have a location, consider it as ceremony venue for single venue type
  UPDATE events 
  SET 
    venue_type = 'single',
    ceremony_venue = COALESCE(location, '{"name": "", "address": "", "city": "", "postalCode": ""}'),
    ceremony_date = date::DATE,
    ceremony_time = date::TIME
  WHERE venue_type IS NULL AND location IS NOT NULL;

  -- For events without location, set default structure
  UPDATE events 
  SET 
    venue_type = 'single',
    ceremony_venue = '{"name": "", "address": "", "city": "", "postalCode": ""}',
    ceremony_date = date::DATE,
    ceremony_time = date::TIME
  WHERE venue_type IS NULL AND location IS NULL;

  -- Log the migration
  RAISE NOTICE 'Migrated % events to new venue structure', 
    (SELECT COUNT(*) FROM events WHERE venue_type IS NOT NULL);
END;
$$ LANGUAGE plpgsql;

-- Execute the migration function
SELECT migrate_existing_events_to_venues();

-- Add comments for documentation
COMMENT ON COLUMN events.ceremony_venue IS 'JSONB object containing ceremony venue details: {name, address, city, postalCode, coordinates}';
COMMENT ON COLUMN events.reception_venue IS 'JSONB object containing reception venue details: {name, address, city, postalCode, coordinates}';
COMMENT ON COLUMN events.ceremony_date IS 'Date of the ceremony (separate from time for better UI/UX)';
COMMENT ON COLUMN events.ceremony_time IS 'Time of the ceremony';
COMMENT ON COLUMN events.reception_date IS 'Date of the reception (separate from time for better UI/UX)';
COMMENT ON COLUMN events.reception_time IS 'Time of the reception';
COMMENT ON COLUMN events.venue_type IS 'Type of venue: single (same venue for ceremony and reception) or separate';

-- Create validation function
CREATE OR REPLACE FUNCTION validate_event_venues()
RETURNS trigger AS $$
BEGIN
  -- Validate venue_type and corresponding data
  IF NEW.venue_type = 'separate' THEN
    -- For separate venues, both ceremony and reception venues must be provided
    IF NEW.ceremony_venue IS NULL OR NEW.reception_venue IS NULL THEN
      RAISE EXCEPTION 'Both ceremony_venue and reception_venue must be provided for separate venue type';
    END IF;
    
    IF NEW.ceremony_date IS NULL OR NEW.reception_date IS NULL THEN
      RAISE EXCEPTION 'Both ceremony_date and reception_date must be provided for separate venue type';
    END IF;
  ELSE
    -- For single venue, ceremony venue is required, reception venue should be null
    IF NEW.ceremony_venue IS NULL THEN
      RAISE EXCEPTION 'ceremony_venue is required for single venue type';
    END IF;
    
    IF NEW.ceremony_date IS NULL THEN
      RAISE EXCEPTION 'ceremony_date is required';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for validation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'validate_event_venues_trigger'
  ) THEN
    CREATE TRIGGER validate_event_venues_trigger
      BEFORE INSERT OR UPDATE ON events
      FOR EACH ROW EXECUTE FUNCTION validate_event_venues();
  END IF;
END $$;
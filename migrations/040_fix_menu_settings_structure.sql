-- ============================================================================
-- Migration: Fix menu_settings structure for frontend compatibility
-- Date: 2026-02-08
-- Description: Ensures menu_settings column has the correct structure expected by frontend
-- ============================================================================

-- ============================================================================
-- 1. Fix menu_settings column structure
-- ============================================================================
DO $$
BEGIN
    -- Check if menu_settings column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'menu_settings') THEN
        ALTER TABLE events ADD COLUMN menu_settings JSONB DEFAULT '{
          "message": true,
          "histoire": true,
          "invitation": true,
          "table": false,
          "game": true,
          "avis": true,
          "menu_type": "manual",
          "menu_file_url": null,
          "menu_items": []
        }'::jsonb;
    ELSE
        -- Update existing events to have the correct structure if they have old format
        UPDATE events 
        SET menu_settings = '{
          "message": true,
          "histoire": true,
          "invitation": true,
          "table": false,
          "game": true,
          "avis": true,
          "menu_type": "manual",
          "menu_file_url": null,
          "menu_items": []
        }'::jsonb
        WHERE menu_settings IS NULL 
           OR menu_settings->>'enabled' IS NOT NULL  -- Old format detection
           OR menu_settings->>'message' IS NULL;      -- Missing required field
    END IF;
END $$;

-- ============================================================================
-- 2. Create index for menu_settings queries if not exists
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_events_menu_settings ON events USING GIN (menu_settings);

-- ============================================================================
-- 3. Create function to validate menu_settings structure
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_menu_settings(settings JSONB)
RETURNS JSONB AS $$
DECLARE
    default_settings JSONB := '{
        "message": true,
        "histoire": true,
        "invitation": true,
        "table": false,
        "game": true,
        "avis": true,
        "menu_type": "manual",
        "menu_file_url": null,
        "menu_items": []
    }'::jsonb;
BEGIN
    IF settings IS NULL THEN
        RETURN default_settings;
    END IF;
    
    -- Merge with defaults to ensure all required fields exist
    RETURN default_settings || settings;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Create trigger to auto-validate menu_settings on insert/update
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_validate_menu_settings()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.menu_settings IS NOT NULL THEN
        NEW.menu_settings := validate_menu_settings(NEW.menu_settings);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_validate_event_menu_settings ON events;

-- Create trigger
CREATE TRIGGER trigger_validate_event_menu_settings
    BEFORE INSERT OR UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION trigger_validate_menu_settings();

-- ============================================================================
-- 5. Update existing events to ensure valid structure
-- ============================================================================
UPDATE events 
SET menu_settings = validate_menu_settings(menu_settings)
WHERE menu_settings IS NOT NULL;

-- ============================================================================
-- 6. Add comment for documentation
-- ============================================================================
COMMENT ON COLUMN events.menu_settings IS 'JSON object storing menu visibility settings for guest interface: message, histoire, invitation, table, game, avis, menu_type (manual/file), menu_file_url, menu_items array';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT 
    'Menu Settings Fix Complete' as status,
    (SELECT COUNT(*) FROM events WHERE menu_settings IS NULL) as null_settings_count,
    (SELECT COUNT(*) FROM events WHERE menu_settings->>'message' IS NOT NULL) as valid_settings_count,
    NOW() as executed_at;

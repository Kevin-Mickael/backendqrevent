-- ============================================================================
-- MIGRATION: Consolidated Schema Optimization
-- Date: 2026-02-07
-- Description: 
--   - Consolidates all previous migrations
--   - Optimizes schema for scalability (10k+ concurrent users)
--   - Removes redundancies
--   - Adds proper indexes for performance
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. USERS TABLE OPTIMIZATIONS
-- ============================================================================

-- Add missing columns to users (consolidated from multiple migrations)
DO $$
BEGIN
    -- avatar_url (from 001_add_avatar_url.sql, 004_add_avatar_to_users.sql)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'avatar_url') THEN
        ALTER TABLE users ADD COLUMN avatar_url TEXT;
        COMMENT ON COLUMN users.avatar_url IS 'URL of the user avatar image stored in R2';
    END IF;
    
    -- preferences (from 012_add_preferences_to_users.sql)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'preferences') THEN
        ALTER TABLE users ADD COLUMN preferences JSONB DEFAULT '{}';
    END IF;
END $$;

-- ============================================================================
-- 2. EVENTS TABLE OPTIMIZATIONS
-- ============================================================================

DO $$
BEGIN
    -- Make description nullable (from 019_make_description_nullable.sql)
    ALTER TABLE events ALTER COLUMN description DROP NOT NULL;
    
    -- bride_name and groom_name (from 002_add_couple_names.sql)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'bride_name') THEN
        ALTER TABLE events ADD COLUMN bride_name VARCHAR(100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'groom_name') THEN
        ALTER TABLE events ADD COLUMN groom_name VARCHAR(100);
    END IF;
    
    -- total_budget (from 016_add_total_budget_to_events.sql)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'total_budget') THEN
        ALTER TABLE events ADD COLUMN total_budget DECIMAL(10, 2) DEFAULT 0;
    END IF;
    
    -- guest_count (from 021_add_guest_count_to_events.sql)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'guest_count') THEN
        ALTER TABLE events ADD COLUMN guest_count INTEGER DEFAULT 0;
    END IF;
    
    -- menu_settings (from 017_add_menu_settings_to_events.sql)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'menu_settings') THEN
        ALTER TABLE events ADD COLUMN menu_settings JSONB DEFAULT '{
            "enabled": false,
            "title": "Menu du Jour",
            "subtitle": "Une expérience culinaire unique",
            "description": "",
            "starter": { "title": "Entrée", "description": "" },
            "main": { "title": "Plat Principal", "description": "" },
            "dessert": { "title": "Dessert", "description": "" },
            "drinks": { "title": "Boissons", "description": "" }
        }';
    END IF;
END $$;

-- Optimize events indexes for scalability
CREATE INDEX IF NOT EXISTS idx_events_organizer_active ON events(organizer_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_events_date_active ON events(date, is_active);

-- ============================================================================
-- 3. GUESTS TABLE OPTIMIZATIONS
-- ============================================================================

DO $$
BEGIN
    -- is_active (from 008b_add_is_active_to_guests.sql)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guests' AND column_name = 'is_active') THEN
        ALTER TABLE guests ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    END IF;
END $$;

-- Optimize guests indexes for scalability
CREATE INDEX IF NOT EXISTS idx_guests_event_rsvp ON guests(event_id, rsvp_status) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_guests_event_attendance ON guests(event_id, attendance_status) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_guests_qr_code ON guests(qr_code) WHERE qr_code IS NOT NULL;

-- ============================================================================
-- 4. FAMILIES TABLE OPTIMIZATIONS
-- ============================================================================

DO $$
BEGIN
    -- max_people (from 018_add_max_people_to_families.sql)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'families' AND column_name = 'max_people') THEN
        ALTER TABLE families ADD COLUMN max_people INTEGER DEFAULT 1;
        COMMENT ON COLUMN families.max_people IS 'Maximum number of people invited for this family/group';
    END IF;
END $$;

-- ============================================================================
-- 5. QR_CODES TABLE OPTIMIZATIONS
-- ============================================================================

-- Add composite index for QR verification (most common operation)
CREATE INDEX IF NOT EXISTS idx_qr_codes_code_valid ON qr_codes(code, is_valid) WHERE is_valid = true;

-- Add index for event-based QR lookups
CREATE INDEX IF NOT EXISTS idx_qr_codes_event_valid ON qr_codes(event_id, is_valid);

-- ============================================================================
-- 6. ATTENDANCE TABLE OPTIMIZATIONS
-- ============================================================================

-- Optimize attendance indexes for real-time tracking
CREATE INDEX IF NOT EXISTS idx_attendance_event_status ON attendance(event_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_timestamp_brin ON attendance USING BRIN (timestamp) 
    WITH (pages_per_range = 128);

-- ============================================================================
-- 7. BUDGET_ITEMS TABLE OPTIMIZATIONS
-- ============================================================================

DO $$
BEGIN
    -- quantity and unit_price (from 015_add_quantity_unit_price.sql)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_items' AND column_name = 'quantity') THEN
        ALTER TABLE budget_items ADD COLUMN quantity INTEGER DEFAULT 1;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_items' AND column_name = 'unit_price') THEN
        ALTER TABLE budget_items ADD COLUMN unit_price DECIMAL(10, 2);
    END IF;
    
    -- Recalculate total_price for existing records
    UPDATE budget_items SET total_price = COALESCE(quantity, 1) * COALESCE(unit_price, total_price, 0) 
    WHERE quantity IS NOT NULL AND unit_price IS NOT NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_budget_items_event_category ON budget_items(event_id, category);

-- ============================================================================
-- 8. PERFORMANCE OPTIMIZATIONS
-- ============================================================================

-- Update function for updated_at (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for all tables that need updated_at
DO $$
DECLARE
    tbl TEXT;
    tables TEXT[] := ARRAY['users', 'events', 'guests', 'qr_codes', 'families', 'seating_tables', 
                           'budget_items', 'games', 'wishes', 'feedback', 'story_events'];
BEGIN
    FOREACH tbl IN ARRAY tables
    LOOP
        -- Check if table exists
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
            -- Check if trigger already exists
            IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_' || tbl || '_updated_at') THEN
                EXECUTE format('CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl);
            END IF;
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- 9. CLEANUP REDUNDANT INDEXES
-- ============================================================================

-- Drop redundant single-column indexes if composite indexes exist
DROP INDEX IF EXISTS idx_events_organizer; -- Covered by idx_events_organizer_active

-- ============================================================================
-- 10. VERIFY OPTIMIZATIONS
-- ============================================================================

SELECT 
    'Optimization Summary' as section,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') as total_tables,
    (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public') as total_indexes,
    (SELECT COUNT(*) FROM pg_trigger WHERE tgname LIKE 'update_%_updated_at') as auto_update_triggers;

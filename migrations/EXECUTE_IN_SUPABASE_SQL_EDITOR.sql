-- ============================================================================
-- EXECUTE THIS IN SUPABASE SQL EDITOR
-- Consolidated Schema Optimization for Qrevent
-- Date: 2026-02-07
-- ============================================================================

-- ============================================================================
-- STEP 1: Enable Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- STEP 2: Update users table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'avatar_url') THEN
        ALTER TABLE users ADD COLUMN avatar_url TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'preferences') THEN
        ALTER TABLE users ADD COLUMN preferences JSONB DEFAULT '{}';
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Update events table
-- ============================================================================
DO $$
BEGIN
    -- Make description nullable (fixes creation error)
    ALTER TABLE events ALTER COLUMN description DROP NOT NULL;
    
    -- Add couple names
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'bride_name') THEN
        ALTER TABLE events ADD COLUMN bride_name VARCHAR(100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'groom_name') THEN
        ALTER TABLE events ADD COLUMN groom_name VARCHAR(100);
    END IF;
    
    -- Add budget tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'total_budget') THEN
        ALTER TABLE events ADD COLUMN total_budget DECIMAL(10, 2) DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'guest_count') THEN
        ALTER TABLE events ADD COLUMN guest_count INTEGER DEFAULT 0;
    END IF;
    
    -- Add menu settings
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

-- ============================================================================
-- STEP 4: Optimize events indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_events_organizer_active ON events(organizer_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_events_date_active ON events(date, is_active);

-- ============================================================================
-- STEP 5: Update guests table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guests' AND column_name = 'is_active') THEN
        ALTER TABLE guests ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    END IF;
END $$;

-- Optimize guests indexes
CREATE INDEX IF NOT EXISTS idx_guests_event_rsvp ON guests(event_id, rsvp_status) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_guests_event_attendance ON guests(event_id, attendance_status) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_guests_qr_code ON guests(qr_code) WHERE qr_code IS NOT NULL;

-- ============================================================================
-- STEP 6: Update families table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'families' AND column_name = 'max_people') THEN
        ALTER TABLE families ADD COLUMN max_people INTEGER DEFAULT 1;
    END IF;
END $$;

-- ============================================================================
-- STEP 7: Optimize QR codes indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_qr_codes_code_valid ON qr_codes(code, is_valid) WHERE is_valid = true;
CREATE INDEX IF NOT EXISTS idx_qr_codes_event_valid ON qr_codes(event_id, is_valid);

-- ============================================================================
-- STEP 8: Optimize attendance indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_attendance_event_status ON attendance(event_id, status);

-- BRIN index for time-series data (highly efficient for large tables)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_attendance_timestamp_brin') THEN
        CREATE INDEX idx_attendance_timestamp_brin ON attendance USING BRIN (timestamp) 
        WITH (pages_per_range = 128);
    END IF;
END $$;

-- ============================================================================
-- STEP 9: Update budget_items table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_items' AND column_name = 'quantity') THEN
        ALTER TABLE budget_items ADD COLUMN quantity INTEGER DEFAULT 1;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_items' AND column_name = 'unit_price') THEN
        ALTER TABLE budget_items ADD COLUMN unit_price DECIMAL(10, 2);
    END IF;
    
    -- Recalculate totals
    UPDATE budget_items SET total_price = COALESCE(quantity, 1) * COALESCE(unit_price, total_price, 0) 
    WHERE quantity IS NOT NULL AND unit_price IS NOT NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_budget_items_event_category ON budget_items(event_id, category);

-- ============================================================================
-- STEP 10: Setup auto-update triggers
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for all tables
DO $$
DECLARE
    tbl TEXT;
    tables TEXT[] := ARRAY['users', 'events', 'guests', 'qr_codes', 'families', 'seating_tables', 
                           'budget_items', 'games', 'wishes', 'feedback', 'story_events'];
BEGIN
    FOREACH tbl IN ARRAY tables
    LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
            IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_' || tbl || '_updated_at') THEN
                EXECUTE format('CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl);
            END IF;
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- STEP 11: Drop redundant indexes (cleanup)
-- ============================================================================
DROP INDEX IF EXISTS idx_events_organizer; -- Covered by composite index

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT 
    'Schema Optimization Complete' as status,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') as total_tables,
    (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public') as total_indexes,
    (SELECT COUNT(*) FROM pg_trigger WHERE tgname LIKE 'update_%_updated_at') as auto_update_triggers,
    NOW() as executed_at;

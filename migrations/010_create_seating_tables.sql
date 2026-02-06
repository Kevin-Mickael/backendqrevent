-- Migration: Create seating tables for event table planning
-- Description: Add tables to manage seating arrangements at weddings

-- Create seating_tables table (physical tables at the event)
CREATE TABLE IF NOT EXISTS seating_tables (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    seats INTEGER NOT NULL DEFAULT 8 CHECK (seats > 0 AND seats <= 50),
    table_shape VARCHAR(20) DEFAULT 'round' CHECK (table_shape IN ('round', 'rectangular', 'square', 'oval')),
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create table_assignments table (links guests to tables)
CREATE TABLE IF NOT EXISTS table_assignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    table_id UUID NOT NULL REFERENCES seating_tables(id) ON DELETE CASCADE,
    guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    seat_number INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(table_id, guest_id),
    UNIQUE(table_id, seat_number)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_seating_tables_event ON seating_tables(event_id);
CREATE INDEX IF NOT EXISTS idx_table_assignments_table ON table_assignments(table_id);
CREATE INDEX IF NOT EXISTS idx_table_assignments_guest ON table_assignments(guest_id);

-- Create trigger to automatically update the updated_at column
CREATE TRIGGER update_seating_tables_updated_at 
    BEFORE UPDATE ON seating_tables 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add comment for documentation
COMMENT ON TABLE seating_tables IS 'Physical tables at wedding events for seating arrangements';
COMMENT ON TABLE table_assignments IS 'Links guests to their assigned tables and seats';

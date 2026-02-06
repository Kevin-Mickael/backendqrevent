-- Migration: Link families to seating tables
-- Description: Allow assigning families or manual guests to tables

-- Modify table_assignments to support both guest and family assignments
-- Make guest_id nullable and add family_id
ALTER TABLE table_assignments 
    DROP CONSTRAINT IF EXISTS table_assignments_guest_id_key,
    DROP CONSTRAINT IF EXISTS table_assignments_table_id_guest_id_key;

-- Add family_id column
ALTER TABLE table_assignments 
    ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS assignment_type VARCHAR(20) DEFAULT 'guest' CHECK (assignment_type IN ('guest', 'family', 'manual')),
    ADD COLUMN IF NOT EXISTS manual_guest_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS manual_guest_count INTEGER DEFAULT 1;

-- Modify constraint to allow either guest_id or family_id
ALTER TABLE table_assignments 
    DROP CONSTRAINT IF EXISTS table_assignments_check;

-- Add check constraint: must have either guest_id, family_id, or manual_guest_name
ALTER TABLE table_assignments 
    ADD CONSTRAINT table_assignments_check 
    CHECK (
        (guest_id IS NOT NULL AND family_id IS NULL AND manual_guest_name IS NULL) OR
        (guest_id IS NULL AND family_id IS NOT NULL AND manual_guest_name IS NULL) OR
        (guest_id IS NULL AND family_id IS NULL AND manual_guest_name IS NOT NULL)
    );

-- Create index for family lookups
CREATE INDEX IF NOT EXISTS idx_table_assignments_family ON table_assignments(family_id);
CREATE INDEX IF NOT EXISTS idx_table_assignments_type ON table_assignments(assignment_type);

-- Create table for manual guests (alternative to families)
CREATE TABLE IF NOT EXISTS table_manual_guests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    table_id UUID NOT NULL REFERENCES seating_tables(id) ON DELETE CASCADE,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    dietary_restrictions VARCHAR(200),
    seat_number INTEGER,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_table_manual_guests_table ON table_manual_guests(table_id);

-- Trigger for updated_at
CREATE TRIGGER update_table_manual_guests_updated_at 
    BEFORE UPDATE ON table_manual_guests 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Update comments
COMMENT ON TABLE table_assignments IS 'Links guests, families, or manual entries to tables';
COMMENT ON COLUMN table_assignments.assignment_type IS 'Type: guest (from guests table), family (entire family), or manual (ad-hoc guest)';
COMMENT ON TABLE table_manual_guests IS 'Manual guests added directly to tables (when not using families feature)';

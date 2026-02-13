-- Migration: Create invitation_family_assignments table
-- Description: Link invitation designs to family groups
-- Allows each family to be assigned to a specific invitation design

-- Create invitation_family_assignments table
CREATE TABLE IF NOT EXISTS invitation_family_assignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    invitation_id UUID NOT NULL REFERENCES invitation_designs(id) ON DELETE CASCADE,
    family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

    -- Metadata
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints: A family can only be assigned to one invitation design per event
    CONSTRAINT unique_family_invitation_per_event UNIQUE(event_id, family_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_invitation_family_assignments_invitation ON invitation_family_assignments(invitation_id);
CREATE INDEX IF NOT EXISTS idx_invitation_family_assignments_family ON invitation_family_assignments(family_id);
CREATE INDEX IF NOT EXISTS idx_invitation_family_assignments_event ON invitation_family_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_invitation_family_assignments_assigned_at ON invitation_family_assignments(assigned_at DESC);

-- Add comments for documentation
COMMENT ON TABLE invitation_family_assignments IS 'Links invitation designs to family groups. Each family can be assigned to one design per event.';
COMMENT ON COLUMN invitation_family_assignments.invitation_id IS 'The invitation design assigned to this family';
COMMENT ON COLUMN invitation_family_assignments.family_id IS 'The family receiving this invitation design';
COMMENT ON COLUMN invitation_family_assignments.event_id IS 'The event this assignment belongs to (for quick filtering)';
COMMENT ON COLUMN invitation_family_assignments.assigned_by IS 'User who made the assignment (optional)';

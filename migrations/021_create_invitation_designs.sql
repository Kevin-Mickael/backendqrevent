-- Migration: Create invitation_designs table
-- Description: Store multiple invitation designs per event
-- Each event can have multiple invitation templates/designs
-- Each design can be assigned to different family groups

-- Create invitation_designs table
CREATE TABLE IF NOT EXISTS invitation_designs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Design information
    name VARCHAR(255) NOT NULL,
    template VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'completed')),

    -- Visual assets
    cover_image TEXT,

    -- Design customization (JSON for flexibility)
    custom_data JSONB DEFAULT '{}',

    -- Stats
    views_count INTEGER DEFAULT 0,
    responses_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_design_per_event UNIQUE(event_id, name)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_invitation_designs_event ON invitation_designs(event_id);
CREATE INDEX IF NOT EXISTS idx_invitation_designs_user ON invitation_designs(user_id);
CREATE INDEX IF NOT EXISTS idx_invitation_designs_status ON invitation_designs(status);
CREATE INDEX IF NOT EXISTS idx_invitation_designs_created_at ON invitation_designs(created_at DESC);

-- Create trigger for updated_at
CREATE TRIGGER update_invitation_designs_updated_at
    BEFORE UPDATE ON invitation_designs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE invitation_designs IS 'Stores invitation design templates for events. Each event can have multiple designs.';
COMMENT ON COLUMN invitation_designs.event_id IS 'Reference to the event this design belongs to';
COMMENT ON COLUMN invitation_designs.template IS 'Template identifier (e.g., "elegant-arch", "modern-minimal")';
COMMENT ON COLUMN invitation_designs.custom_data IS 'JSON data for custom design settings (colors, fonts, layout options)';
COMMENT ON COLUMN invitation_designs.views_count IS 'Number of times this design has been viewed';
COMMENT ON COLUMN invitation_designs.responses_count IS 'Number of RSVP responses received for this design';

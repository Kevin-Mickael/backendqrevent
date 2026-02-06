-- Migration: Create family invitations and RSVP tables
-- Description: Add tables to manage family invitations and their RSVP responses

-- Create family_invitations table (links families to events with QR codes)
CREATE TABLE IF NOT EXISTS family_invitations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    family_id UUID REFERENCES families(id) ON DELETE CASCADE,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    invited_count INTEGER NOT NULL DEFAULT 1,
    qr_code VARCHAR(100) UNIQUE NOT NULL,
    qr_expires_at TIMESTAMP WITH TIME ZONE,
    is_valid BOOLEAN DEFAULT TRUE,
    scan_count INTEGER DEFAULT 0,
    last_scanned_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(family_id, event_id) -- One invitation per family per event
);

-- Create family_rsvp table (stores individual responses from family members)
CREATE TABLE IF NOT EXISTS family_rsvp (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    family_invitation_id UUID REFERENCES family_invitations(id) ON DELETE CASCADE,
    member_name VARCHAR(100) NOT NULL,
    will_attend BOOLEAN DEFAULT NULL, -- NULL = not responded, TRUE = attending, FALSE = not attending
    dietary_restrictions TEXT,
    notes TEXT,
    responded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_family_invitations_family ON family_invitations(family_id);
CREATE INDEX IF NOT EXISTS idx_family_invitations_event ON family_invitations(event_id);
CREATE INDEX IF NOT EXISTS idx_family_invitations_qr ON family_invitations(qr_code);
CREATE INDEX IF NOT EXISTS idx_family_invitations_user ON family_invitations(user_id);
CREATE INDEX IF NOT EXISTS idx_family_rsvp_invitation ON family_rsvp(family_invitation_id);

-- Create triggers for updated_at
CREATE TRIGGER update_family_invitations_updated_at BEFORE UPDATE ON family_invitations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_family_rsvp_updated_at BEFORE UPDATE ON family_rsvp FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

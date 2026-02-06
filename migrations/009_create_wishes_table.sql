-- Migration: Create wishes table for guest book messages
-- Created: 2026-02-05

-- Create wishes table (vœux/livre d'or)
CREATE TABLE IF NOT EXISTS wishes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
    author_name VARCHAR(100) NOT NULL,
    author_email VARCHAR(255),
    message TEXT NOT NULL,
    style VARCHAR(20) DEFAULT 'serif' CHECK (style IN ('serif', 'cursive', 'modern')),
    color VARCHAR(50) DEFAULT 'bg-[#F5E6D3]',
    is_public BOOLEAN DEFAULT TRUE,
    is_moderated BOOLEAN DEFAULT FALSE,
    moderated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    moderated_at TIMESTAMP WITH TIME ZONE,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_wishes_event ON wishes(event_id);
CREATE INDEX IF NOT EXISTS idx_wishes_guest ON wishes(guest_id);
CREATE INDEX IF NOT EXISTS idx_wishes_created_at ON wishes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wishes_public ON wishes(event_id, is_public) WHERE is_public = TRUE;

-- Create trigger to automatically update the updated_at column
DROP TRIGGER IF EXISTS update_wishes_updated_at ON wishes;
CREATE TRIGGER update_wishes_updated_at 
    BEFORE UPDATE ON wishes 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add comment for documentation
COMMENT ON TABLE wishes IS 'Table pour stocker les vœux/messages des invités (livre d''or)';
COMMENT ON COLUMN wishes.style IS 'Style d''affichage du message: serif, cursive, ou modern';
COMMENT ON COLUMN wishes.is_public IS 'Si le message est visible publiquement';
COMMENT ON COLUMN wishes.is_moderated IS 'Si le message a été modéré par l''organisateur';

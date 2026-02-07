-- Migration: Create event gallery table for shared photos/videos
-- Description: Allows guests to upload and view photos/videos during events via QR code

-- Create event_gallery table
CREATE TABLE IF NOT EXISTS event_gallery (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
    family_id UUID REFERENCES families(id) ON DELETE SET NULL,
    guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    original_name VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    mime_type VARCHAR(100),
    file_type VARCHAR(20) CHECK (file_type IN ('image', 'video')),
    r2_key TEXT NOT NULL,
    r2_url TEXT NOT NULL,
    thumbnail_url TEXT,
    caption TEXT,
    is_approved BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_event_gallery_event_id ON event_gallery(event_id);
CREATE INDEX IF NOT EXISTS idx_event_gallery_family_id ON event_gallery(family_id);
CREATE INDEX IF NOT EXISTS idx_event_gallery_guest_id ON event_gallery(guest_id);
CREATE INDEX IF NOT EXISTS idx_event_gallery_uploaded_by ON event_gallery(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_event_gallery_file_type ON event_gallery(file_type);
CREATE INDEX IF NOT EXISTS idx_event_gallery_is_approved ON event_gallery(is_approved);
CREATE INDEX IF NOT EXISTS idx_event_gallery_uploaded_at ON event_gallery(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_gallery_is_deleted ON event_gallery(is_deleted);
CREATE INDEX IF NOT EXISTS idx_event_gallery_event_type ON event_gallery(event_id, file_type);
CREATE INDEX IF NOT EXISTS idx_event_gallery_event_approved ON event_gallery(event_id, is_approved);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_event_gallery_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_event_gallery_updated_at_trigger ON event_gallery;
CREATE TRIGGER update_event_gallery_updated_at_trigger
BEFORE UPDATE ON event_gallery
FOR EACH ROW
EXECUTE FUNCTION update_event_gallery_updated_at();

-- Create view for gallery statistics
CREATE OR REPLACE VIEW event_gallery_stats AS
SELECT 
    event_id,
    COUNT(*) as total_items,
    COUNT(*) FILTER (WHERE file_type = 'image') as image_count,
    COUNT(*) FILTER (WHERE file_type = 'video') as video_count,
    SUM(file_size) as total_size,
    COUNT(*) FILTER (WHERE uploaded_at > NOW() - INTERVAL '24 hours') as recent_uploads
FROM event_gallery
WHERE is_deleted = FALSE
GROUP BY event_id;

-- Enable Row Level Security
ALTER TABLE event_gallery ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Policy: Event organizers can view all gallery items for their events
CREATE POLICY event_gallery_organizer_select ON event_gallery
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM events 
            WHERE events.id = event_gallery.event_id 
            AND events.organizer_id = auth.uid()
        )
    );

-- Policy: Event organizers can insert gallery items for their events
CREATE POLICY event_gallery_organizer_insert ON event_gallery
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM events 
            WHERE events.id = event_gallery.event_id 
            AND events.organizer_id = auth.uid()
        )
    );

-- Policy: Event organizers can update gallery items for their events
CREATE POLICY event_gallery_organizer_update ON event_gallery
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM events 
            WHERE events.id = event_gallery.event_id 
            AND events.organizer_id = auth.uid()
        )
    );

-- Policy: Everyone can view approved gallery items for active events
CREATE POLICY event_gallery_public_select ON event_gallery
    FOR SELECT
    USING (
        is_approved = TRUE 
        AND is_deleted = FALSE
        AND EXISTS (
            SELECT 1 FROM events 
            WHERE events.id = event_gallery.event_id 
            AND events.is_active = TRUE
        )
    );

-- Create function to get gallery by event
CREATE OR REPLACE FUNCTION get_event_gallery(p_event_id UUID, p_file_type TEXT DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    event_id UUID,
    family_id UUID,
    guest_id UUID,
    uploaded_by UUID,
    original_name VARCHAR,
    file_name VARCHAR,
    file_size BIGINT,
    mime_type VARCHAR,
    file_type VARCHAR,
    r2_url TEXT,
    thumbnail_url TEXT,
    caption TEXT,
    is_approved BOOLEAN,
    is_featured BOOLEAN,
    uploaded_at TIMESTAMP WITH TIME ZONE,
    uploader_name TEXT,
    family_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        eg.id,
        eg.event_id,
        eg.family_id,
        eg.guest_id,
        eg.uploaded_by,
        eg.original_name,
        eg.file_name,
        eg.file_size,
        eg.mime_type,
        eg.file_type,
        eg.r2_url,
        eg.thumbnail_url,
        eg.caption,
        eg.is_approved,
        eg.is_featured,
        eg.uploaded_at,
        COALESCE(u.name, 'Anonyme') as uploader_name,
        f.name as family_name
    FROM event_gallery eg
    LEFT JOIN users u ON u.id = eg.uploaded_by
    LEFT JOIN families f ON f.id = eg.family_id
    WHERE eg.event_id = p_event_id
    AND eg.is_deleted = FALSE
    AND eg.is_approved = TRUE
    AND (p_file_type IS NULL OR eg.file_type = p_file_type)
    ORDER BY eg.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON TABLE event_gallery IS 'Shared photo/video gallery for events, accessible by scanning QR code';

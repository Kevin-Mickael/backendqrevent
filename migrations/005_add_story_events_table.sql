-- Migration: Add story_events table for Histoire feature
-- Created: 2026-02-05

-- Create story_events table if not exists
CREATE TABLE IF NOT EXISTS story_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    event_date DATE,
    location VARCHAR(200),
    description TEXT,
    media_type VARCHAR(20) DEFAULT 'photo' CHECK (media_type IN ('photo', 'video')),
    media_url TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries by event_id
CREATE INDEX IF NOT EXISTS idx_story_events_event_id ON story_events(event_id);

-- Create index for sorting
CREATE INDEX IF NOT EXISTS idx_story_events_sort_order ON story_events(sort_order);

-- Enable Row Level Security
ALTER TABLE story_events ENABLE ROW LEVEL SECURITY;

-- Create policy for users to only see their own event's story events
-- Note: This requires a join with events table to check organizer_id
-- For now, we rely on application-level authorization

-- Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_story_events_updated_at ON story_events;
CREATE TRIGGER update_story_events_updated_at
    BEFORE UPDATE ON story_events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

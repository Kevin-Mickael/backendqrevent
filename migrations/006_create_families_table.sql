-- Migration: Create families table
-- Description: Add table to store family groups for invitations

-- Create families table
CREATE TABLE IF NOT EXISTS families (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    members TEXT[], -- Array of member names
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries by user
CREATE INDEX IF NOT EXISTS idx_families_user ON families(user_id);

-- Create trigger to automatically update the updated_at column
CREATE TRIGGER update_families_updated_at BEFORE UPDATE ON families FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

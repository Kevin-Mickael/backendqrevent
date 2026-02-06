-- Add files table if it doesn't exist
CREATE TABLE IF NOT EXISTS files (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    original_name VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL, -- Unique file name in R2
    file_path TEXT NOT NULL, -- Full path in R2 (e.g., user_id/menu/submenu/filename.ext)
    file_size BIGINT,
    mime_type VARCHAR(100),
    menu VARCHAR(100) NOT NULL, -- Main menu (e.g., 'messages', 'histoire', 'invitations')
    submenu VARCHAR(100), -- Submenu (e.g., 'photos', 'videos', 'documents')
    r2_key TEXT NOT NULL, -- Full key in R2 bucket
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB -- Additional metadata about the file
);

-- Create indexes for the files table
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_event_id ON files(event_id);
CREATE INDEX IF NOT EXISTS idx_files_menu ON files(menu);
CREATE INDEX IF NOT EXISTS idx_files_submenu ON files(submenu);
CREATE INDEX IF NOT EXISTS idx_files_r2_key ON files(r2_key);
CREATE INDEX IF NOT EXISTS idx_files_is_deleted ON files(is_deleted);
CREATE INDEX IF NOT EXISTS idx_files_user_menu ON files(user_id, menu);
CREATE INDEX IF NOT EXISTS idx_files_user_menu_submenu ON files(user_id, menu, submenu);

-- Create or replace the update_updated_at_column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for files table
CREATE TRIGGER update_files_updated_at
BEFORE UPDATE ON files
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
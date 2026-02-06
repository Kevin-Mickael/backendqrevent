-- Add preferences column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{
  "language": "en",
  "theme": "light", 
  "notifications": true,
  "timezone": "UTC"
}'::jsonb;

-- Add avatar_url column if not exists
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

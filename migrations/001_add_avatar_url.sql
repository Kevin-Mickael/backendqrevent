-- Migration: Add avatar_url column to users table
-- Date: 2026-02-05
-- Author: QR Event Team
-- Description: Adds support for user profile avatars stored in R2

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Add avatar_url column to users table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'users' 
        AND column_name = 'avatar_url'
    ) THEN
        ALTER TABLE public.users ADD COLUMN avatar_url TEXT;
        
        -- Add comment for documentation
        COMMENT ON COLUMN public.users.avatar_url IS 'URL of the user avatar image stored in R2 (Cloudflare)';
        
        RAISE NOTICE '✅ Column avatar_url added to users table';
    ELSE
        RAISE NOTICE 'ℹ️  Column avatar_url already exists in users table';
    END IF;
END $$;

-- Add index for performance if needed later
-- CREATE INDEX IF NOT EXISTS idx_users_avatar_url ON public.users(avatar_url) WHERE avatar_url IS NOT NULL;

-- Verify migration
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'users' 
ORDER BY ordinal_position;

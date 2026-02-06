-- Migration: Add bride_name and groom_name columns to events table
-- Date: 2026-02-05
-- Author: QR Event Team
-- Description: Adds support for storing couple names for wedding events

-- Add bride_name column to events table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'events' 
        AND column_name = 'bride_name'
    ) THEN
        ALTER TABLE public.events ADD COLUMN bride_name VARCHAR(100);
        
        COMMENT ON COLUMN public.events.bride_name IS 'Name of the bride for wedding events';
        
        RAISE NOTICE '✅ Column bride_name added to events table';
    ELSE
        RAISE NOTICE 'ℹ️  Column bride_name already exists in events table';
    END IF;
END $$;

-- Add groom_name column to events table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'events' 
        AND column_name = 'groom_name'
    ) THEN
        ALTER TABLE public.events ADD COLUMN groom_name VARCHAR(100);
        
        COMMENT ON COLUMN public.events.groom_name IS 'Name of the groom for wedding events';
        
        RAISE NOTICE '✅ Column groom_name added to events table';
    ELSE
        RAISE NOTICE 'ℹ️  Column groom_name already exists in events table';
    END IF;
END $$;

-- Verify migration
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public'
AND table_name = 'events' 
ORDER BY ordinal_position;

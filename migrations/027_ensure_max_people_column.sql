-- Migration: Ensure max_people column exists in families table
-- Description: Force creation of max_people column if missing

-- Add max_people column with safety check
DO $$
BEGIN
    -- Check if the column exists and add it if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'families' AND column_name = 'max_people') THEN
        ALTER TABLE families ADD COLUMN max_people INTEGER DEFAULT 1;
        COMMENT ON COLUMN families.max_people IS 'Maximum number of people invited for this family/group';
        RAISE NOTICE 'Added max_people column to families table';
    ELSE
        RAISE NOTICE 'max_people column already exists in families table';
    END IF;
END $$;

-- Ensure all existing families have a default value
UPDATE families 
SET max_people = COALESCE(array_length(members, 1), 1) 
WHERE max_people IS NULL;
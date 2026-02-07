-- Migration: Add max_people column to families table
-- Description: Add column to store the maximum number of people invited for a family/group

-- Add max_people column
ALTER TABLE families 
ADD COLUMN IF NOT EXISTS max_people INTEGER DEFAULT 1;

-- Add comment for documentation
COMMENT ON COLUMN families.max_people IS 'Maximum number of people invited for this family/group';

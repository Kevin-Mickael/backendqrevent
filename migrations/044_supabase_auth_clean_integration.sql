-- =============================================================================
-- Migration: Clean users table and integrate Supabase Auth
-- =============================================================================
-- WARNING: This migration will DELETE all existing users!
-- Run this in Supabase SQL Editor
-- =============================================================================

-- Step 1: Drop foreign key constraints temporarily
-- (Events, guests, etc. will cascade delete)

-- First, let's see what tables reference users
-- SELECT 
--     tc.table_name, 
--     kcu.column_name, 
--     ccu.table_name AS foreign_table_name,
--     ccu.column_name AS foreign_column_name 
-- FROM 
--     information_schema.table_constraints AS tc 
--     JOIN information_schema.key_column_usage AS kcu
--       ON tc.constraint_name = kcu.constraint_name
--     JOIN information_schema.constraint_column_usage AS ccu
--       ON ccu.constraint_name = tc.constraint_name
-- WHERE constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'users';

-- Step 2: Delete all existing data (CASCADE will handle related records)
-- ATTENTION: This will delete ALL events, guests, etc.!
TRUNCATE TABLE public.users CASCADE;

-- Step 3: Add auth_id column to link public.users with auth.users
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- Step 4: Create index for faster lookups by auth_id
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);

-- Step 5: Make password_hash nullable (will be managed by Supabase Auth)
ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;

-- Step 6: Function to handle new user signup from Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (
    id,
    auth_id,
    name,
    email,
    role,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    gen_random_uuid(),
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'organizer'),
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT (email) DO UPDATE SET
    auth_id = EXCLUDED.auth_id,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$;

-- Step 7: Create trigger to auto-create public.users on auth signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Step 8: Function to sync profile updates
CREATE OR REPLACE FUNCTION public.sync_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.auth_id IS NOT NULL THEN
    UPDATE auth.users
    SET raw_user_meta_data = jsonb_build_object(
      'name', NEW.name,
      'avatar_url', NEW.avatar_url,
      'role', NEW.role
    ),
    updated_at = NOW()
    WHERE id = NEW.auth_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Step 9: Create trigger to sync profile changes
DROP TRIGGER IF EXISTS on_user_profile_updated ON public.users;
CREATE TRIGGER on_user_profile_updated
  AFTER UPDATE OF name, avatar_url, role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_profile();

-- Step 10: Function to get user by auth_id
CREATE OR REPLACE FUNCTION public.get_user_by_auth_id(p_auth_id UUID)
RETURNS TABLE (
  id UUID,
  auth_id UUID,
  name VARCHAR,
  email VARCHAR,
  role VARCHAR,
  is_active BOOLEAN,
  avatar_url TEXT,
  preferences JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.auth_id,
    u.name,
    u.email,
    u.role,
    u.is_active,
    u.avatar_url,
    u.preferences,
    u.created_at,
    u.updated_at
  FROM public.users u
  WHERE u.auth_id = p_auth_id;
END;
$$;

-- Step 11: Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.users TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_by_auth_id(UUID) TO authenticated;

-- Step 12: RLS policies
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT
  USING (auth_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE
  USING (auth_id = auth.uid());

DROP POLICY IF EXISTS "Service role has full access" ON public.users;
CREATE POLICY "Service role has full access" ON public.users
  USING (auth.role() = 'service_role');

-- Step 13: Delete any existing auth users (optional - do this manually in dashboard if needed)
-- DELETE FROM auth.users;

SELECT 'Migration complete! Users table cleaned and Supabase Auth integrated.' AS status;

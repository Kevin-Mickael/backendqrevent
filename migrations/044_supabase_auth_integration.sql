-- =============================================================================
-- Migration: Integrate Supabase Auth with existing public.users table
-- =============================================================================
-- This migration creates a bridge between Supabase's auth.users and the existing
-- public.users table, allowing Supabase Auth to manage authentication while
-- preserving all existing business logic and foreign key relationships.
-- =============================================================================

-- Step 1: Add auth_id column to link public.users with auth.users
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- Step 2: Create index for faster lookups by auth_id
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);

-- Step 3: Make password_hash nullable (will be managed by Supabase Auth)
ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;

-- Step 4: Function to handle new user signup from Supabase Auth
-- This creates a corresponding public.users record when someone signs up
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

-- Step 5: Create trigger to auto-create public.users on auth signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Step 6: Function to sync profile updates bidirectionally
CREATE OR REPLACE FUNCTION public.sync_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- When public.users is updated, sync relevant fields to auth.users metadata
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

-- Step 7: Create trigger to sync profile changes
DROP TRIGGER IF EXISTS on_user_profile_updated ON public.users;
CREATE TRIGGER on_user_profile_updated
  AFTER UPDATE OF name, avatar_url, role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_profile();

-- Step 8: Function to get user by auth_id (for middleware lookups)
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

-- Step 9: Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.users TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_by_auth_id(UUID) TO authenticated;

-- Step 10: Add RLS policy for users to read their own profile via auth_id
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT
  USING (auth_id = auth.uid() OR id::text = auth.jwt()->>'sub');

-- Enable RLS on users table if not already enabled
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Step 11: Allow service role to bypass RLS for admin operations
DROP POLICY IF EXISTS "Service role has full access" ON public.users;
CREATE POLICY "Service role has full access" ON public.users
  USING (auth.role() = 'service_role');

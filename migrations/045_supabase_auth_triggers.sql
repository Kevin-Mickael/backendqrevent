-- =============================================================================
-- Migration 045: Setup Supabase Auth Integration Triggers
-- =============================================================================

-- Step 1: Add auth_id column to link public.users with auth.users
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'auth_id') THEN
        ALTER TABLE public.users 
        ADD COLUMN auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Step 2: Create index for faster lookups by auth_id
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);

-- Step 3: Make password_hash nullable (will be managed by Supabase Auth)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash' AND is_nullable = 'NO') THEN
        ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;
    END IF;
END $$;

-- Step 4: Function to handle new user signup from Supabase Auth
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

-- Step 6: Function to sync profile updates
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

-- Step 7: Create trigger to sync profile changes
DROP TRIGGER IF EXISTS on_user_profile_updated ON public.users;
CREATE TRIGGER on_user_profile_updated
  AFTER UPDATE OF name, avatar_url, role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_profile();

-- Step 8: Function to get user by auth_id
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

-- Step 10: RLS policies
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
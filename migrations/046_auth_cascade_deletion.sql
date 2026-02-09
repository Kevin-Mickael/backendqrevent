-- =============================================================================
-- Migration 046: Setup cascade deletion for auth.users → public.users
-- =============================================================================

-- Step 1: Function to handle user deletion from Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_auth_user_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Delete user profile from public.users when auth.users record is deleted
  DELETE FROM public.users WHERE auth_id = OLD.id;
  
  -- Log the deletion for audit purposes
  RAISE LOG 'User profile deleted for auth_id: %', OLD.id;
  
  RETURN OLD;
END;
$$;

-- Step 2: Create trigger for auth user deletion
DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_deletion();

-- Step 3: Also update the foreign key constraint to handle cascade properly
-- First drop the existing constraint if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'users_auth_id_fkey' 
        AND table_name = 'users'
    ) THEN
        ALTER TABLE public.users DROP CONSTRAINT users_auth_id_fkey;
    END IF;
END $$;

-- Re-add the foreign key constraint with CASCADE delete
ALTER TABLE public.users 
ADD CONSTRAINT users_auth_id_fkey 
FOREIGN KEY (auth_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 4: Function to handle cascade deletion of related data
CREATE OR REPLACE FUNCTION public.handle_user_cascade_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Log what will be deleted
  RAISE LOG 'Cascading deletion for user_id: %, email: %', OLD.id, OLD.email;
  
  -- Note: Other related data (events, guests, etc.) should already be handled
  -- by existing foreign key constraints with CASCADE
  
  RETURN OLD;
END;
$$;

-- Step 5: Create trigger for public.users deletion to log cascade effects
DROP TRIGGER IF EXISTS on_public_user_deleted ON public.users;
CREATE TRIGGER on_public_user_deleted
  BEFORE DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_cascade_deletion();

-- Step 6: Grant necessary permissions for the triggers
GRANT EXECUTE ON FUNCTION public.handle_auth_user_deletion() TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_user_cascade_deletion() TO service_role;

-- Step 7: Verification query to check the setup
-- This will show the trigger and constraint information
SELECT 
  'Auth cascade deletion setup complete' as status,
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_deleted') as deletion_trigger_exists,
  EXISTS(SELECT 1 FROM information_schema.table_constraints 
         WHERE constraint_name = 'users_auth_id_fkey' 
         AND table_name = 'users') as fk_constraint_exists;
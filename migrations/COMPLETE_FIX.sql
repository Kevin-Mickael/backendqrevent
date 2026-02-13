-- ========================================
-- SCRIPT COMPLET DE CORRECTION
-- À exécuter dans l'éditeur SQL de Supabase
-- ========================================

-- PARTIE 1: Ajouter les colonnes partner1_name et partner2_name
-- ========================================

DO $$
BEGIN
  -- Add partner names columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events'
    AND column_name = 'partner1_name'
  ) THEN
    ALTER TABLE events ADD COLUMN partner1_name VARCHAR(100);
    RAISE NOTICE 'Added partner1_name column';
  ELSE
    RAISE NOTICE 'Column partner1_name already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events'
    AND column_name = 'partner2_name'
  ) THEN
    ALTER TABLE events ADD COLUMN partner2_name VARCHAR(100);
    RAISE NOTICE 'Added partner2_name column';
  ELSE
    RAISE NOTICE 'Column partner2_name already exists';
  END IF;

  -- Add indexes for partner names
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'events'
    AND indexname = 'idx_events_partner1_name'
  ) THEN
    CREATE INDEX idx_events_partner1_name ON events(partner1_name);
    RAISE NOTICE 'Created index on partner1_name';
  ELSE
    RAISE NOTICE 'Index idx_events_partner1_name already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'events'
    AND indexname = 'idx_events_partner2_name'
  ) THEN
    CREATE INDEX idx_events_partner2_name ON events(partner2_name);
    RAISE NOTICE 'Created index on partner2_name';
  ELSE
    RAISE NOTICE 'Index idx_events_partner2_name already exists';
  END IF;

END $$;

-- Migrate existing bride_name and groom_name to new partner fields if they exist
DO $$
BEGIN
  -- Check if bride_name column exists and migrate data
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'bride_name'
  ) THEN
    UPDATE events
    SET partner2_name = bride_name
    WHERE bride_name IS NOT NULL AND partner2_name IS NULL;

    RAISE NOTICE 'Migrated bride_name to partner2_name';
  END IF;

  -- Check if groom_name column exists and migrate data
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'groom_name'
  ) THEN
    UPDATE events
    SET partner1_name = groom_name
    WHERE groom_name IS NOT NULL AND partner1_name IS NULL;

    RAISE NOTICE 'Migrated groom_name to partner1_name';
  END IF;
END $$;

-- PARTIE 2: Fix RLS Policies pour permettre au service role d'opérer
-- ========================================

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Deny Public Access" ON qr_codes;
DROP POLICY IF EXISTS "Deny Public Access" ON family_invitations;
DROP POLICY IF EXISTS "Deny Public Access" ON guests;
DROP POLICY IF EXISTS "Deny Public Access" ON events;
DROP POLICY IF EXISTS "Deny Public Access" ON users;
DROP POLICY IF EXISTS "Deny Public Access" ON attendance;
DROP POLICY IF EXISTS "Deny Public Access" ON files;

-- QR Codes: Allow service role full access, deny anon
CREATE POLICY "Service role full access" ON qr_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Deny anon access" ON qr_codes
  FOR ALL
  TO anon
  USING (false);

-- Family Invitations: Allow service role full access, deny anon
CREATE POLICY "Service role full access" ON family_invitations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Deny anon access" ON family_invitations
  FOR ALL
  TO anon
  USING (false);

-- Guests: Allow service role full access, deny anon
CREATE POLICY "Service role full access" ON guests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Deny anon access" ON guests
  FOR ALL
  TO anon
  USING (false);

-- Events: Allow service role full access, deny anon
CREATE POLICY "Service role full access" ON events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Deny anon access" ON events
  FOR ALL
  TO anon
  USING (false);

-- Users: Allow service role full access, deny anon
CREATE POLICY "Service role full access" ON users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Deny anon access" ON users
  FOR ALL
  TO anon
  USING (false);

-- Attendance: Allow service role full access, deny anon
CREATE POLICY "Service role full access" ON attendance
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Deny anon access" ON attendance
  FOR ALL
  TO anon
  USING (false);

-- Files: Allow service role full access, deny anon
CREATE POLICY "Service role full access" ON files
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Deny anon access" ON files
  FOR ALL
  TO anon
  USING (false);

-- PARTIE 3: Vérification finale
-- ========================================

-- Afficher les colonnes de la table events
SELECT
  'Events table columns:' as info,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'events'
AND column_name IN ('partner1_name', 'partner2_name', 'bride_name', 'groom_name')
ORDER BY column_name;

-- Afficher un échantillon de données
SELECT
  'Sample events data:' as info,
  id,
  title,
  partner1_name,
  partner2_name,
  bride_name,
  groom_name
FROM events
LIMIT 5;

-- Afficher les politiques RLS
SELECT
  'RLS Policies:' as info,
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
FROM pg_policies
WHERE tablename IN ('events', 'qr_codes', 'family_invitations')
ORDER BY tablename, policyname;

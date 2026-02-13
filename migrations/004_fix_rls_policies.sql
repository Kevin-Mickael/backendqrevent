-- Fix RLS policies to allow service role operations
-- Service role should bypass RLS automatically, but we add explicit policies for safety

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

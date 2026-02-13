-- Fix des politiques RLS pour permettre au service role de fonctionner

-- QR Codes
DROP POLICY IF EXISTS "Deny Public Access" ON qr_codes;
DROP POLICY IF EXISTS "Service role full access" ON qr_codes;
DROP POLICY IF EXISTS "Deny anon access" ON qr_codes;

CREATE POLICY "Service role full access" ON qr_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Deny anon access" ON qr_codes
  FOR ALL TO anon USING (false);

-- Family Invitations
DROP POLICY IF EXISTS "Deny Public Access" ON family_invitations;
DROP POLICY IF EXISTS "Service role full access" ON family_invitations;
DROP POLICY IF EXISTS "Deny anon access" ON family_invitations;

CREATE POLICY "Service role full access" ON family_invitations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Deny anon access" ON family_invitations
  FOR ALL TO anon USING (false);

-- Events
DROP POLICY IF EXISTS "Deny Public Access" ON events;
DROP POLICY IF EXISTS "Service role full access" ON events;
DROP POLICY IF EXISTS "Deny anon access" ON events;

CREATE POLICY "Service role full access" ON events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Deny anon access" ON events
  FOR ALL TO anon USING (false);

-- Guests
DROP POLICY IF EXISTS "Deny Public Access" ON guests;
DROP POLICY IF EXISTS "Service role full access" ON guests;
DROP POLICY IF EXISTS "Deny anon access" ON guests;

CREATE POLICY "Service role full access" ON guests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Deny anon access" ON guests
  FOR ALL TO anon USING (false);

-- Users
DROP POLICY IF EXISTS "Deny Public Access" ON users;
DROP POLICY IF EXISTS "Service role full access" ON users;
DROP POLICY IF EXISTS "Deny anon access" ON users;

CREATE POLICY "Service role full access" ON users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Deny anon access" ON users
  FOR ALL TO anon USING (false);

-- Confirmation
SELECT 'Politiques RLS corrigées avec succès!' as status;

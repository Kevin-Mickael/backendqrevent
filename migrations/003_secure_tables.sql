-- Enable Row Level Security on all sensitive tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- Create "Deny Public Access" policy for each table
-- This effectively blocks all access via the Anon Key
-- The Service Role Key will still have full access as it bypasses RLS

-- Users Table
CREATE POLICY "Deny Public Access" ON users
  FOR ALL
  USING (false);

-- Events Table
CREATE POLICY "Deny Public Access" ON events
  FOR ALL
  USING (false);

-- Guests Table
CREATE POLICY "Deny Public Access" ON guests
  FOR ALL
  USING (false);

-- QR Codes Table
CREATE POLICY "Deny Public Access" ON qr_codes
  FOR ALL
  USING (false);

-- Attendance Table
CREATE POLICY "Deny Public Access" ON attendance
  FOR ALL
  USING (false);

-- Files Table
CREATE POLICY "Deny Public Access" ON files
  FOR ALL
  USING (false);

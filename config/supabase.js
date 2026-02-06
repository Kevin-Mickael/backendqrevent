const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

// Create Supabase client with anon key for client-side operations
const supabaseAnon = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey
);

// Create Supabase client with service role key for server-side operations
const supabaseService = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey
);

module.exports = {
  supabaseAnon,
  supabaseService
};
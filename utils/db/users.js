const { supabaseService } = require('../../config/supabase');

// User database utilities
const userDb = {
  // Create a new user
  create: async (userData) => {
    const { data, error } = await supabaseService
      .from('users')
      .insert([userData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating user: ${error.message}`);
    }

    return data;
  },

  // Find user by ID with retry logic
  findById: async (id, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const { data, error, status } = await supabaseService
          .from('users')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          if (error.code === 'PGRST116' || status === 404 || status === 406) {
            // Cela signifie simplement que l'utilisateur n'existe pas
            return null;
          }
          
          // Check if it's a network error that might be retryable
          if (attempt < retries && (
            error.message.includes('fetch failed') || 
            error.message.includes('network') ||
            status >= 500
          )) {
            console.warn(`🔄 Database retry ${attempt}/${retries} for user findById:`, error.message);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          
          // Sinon, c'est une vraie erreur technique
          throw new Error(`Error finding user: ${error.message}`);
        }

        return data;
      } catch (networkError) {
        if (attempt < retries && networkError.message.includes('fetch failed')) {
          console.warn(`🔄 Network retry ${attempt}/${retries} for user findById:`, networkError.message);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        throw new Error(`Error finding user: ${networkError.message}`);
      }
    }
    
    throw new Error('Max retries exceeded for user findById query');
  },

  // Find user by email with retry logic
  findByEmail: async (email, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const { data, error, status } = await supabaseService
          .from('users')
          .select('*')
          .ilike('email', email)
          .single();

        // Si l'utilisateur n'existe pas, Supabase renvoie une erreur avec status 406 ou 404
        if (error) {
          if (error.code === 'PGRST116' || status === 404 || status === 406) {
            // Cela signifie simplement que l'utilisateur n'existe pas
            return null;
          }
          
          // Check if it's a network error that might be retryable
          if (attempt < retries && (
            error.message.includes('fetch failed') || 
            error.message.includes('network') ||
            status >= 500
          )) {
            console.warn(`🔄 Database retry ${attempt}/${retries} for email query:`, error.message);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // exponential backoff
            continue;
          }
          
          // Sinon, c'est une vraie erreur technique
          throw new Error(`Error finding user by email: ${error.message}`);
        }

        return data;
      } catch (networkError) {
        if (attempt < retries && networkError.message.includes('fetch failed')) {
          console.warn(`🔄 Network retry ${attempt}/${retries} for email query:`, networkError.message);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        throw new Error(`Error finding user by email: ${networkError.message}`);
      }
    }
    
    throw new Error('Max retries exceeded for database query');
  },

  // Update user
  update: async (id, userData) => {
    const { data, error, status } = await supabaseService
      .from('users')
      .update(userData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (status === 406 || status === 404) {
        // No rows matched the condition (user ID doesn't exist)
        throw new Error(`User not found with ID: ${id}`);
      }
      throw new Error(`Error updating user: ${error.message}`);
    }

    return data;
  },

  // Delete user (soft delete)
  softDelete: async (id) => {
    const { data, error } = await supabaseService
      .from('users')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting user: ${error.message}`);
    }

    return data;
  }
};

module.exports = userDb;
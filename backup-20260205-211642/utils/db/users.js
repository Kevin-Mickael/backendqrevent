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

  // Find user by ID
  findById: async (id) => {
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
      // Sinon, c'est une vraie erreur technique
      throw new Error(`Error finding user: ${error.message}`);
    }

    return data;
  },

  // Find user by email
  findByEmail: async (email) => {
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
      // Sinon, c'est une vraie erreur technique
      throw new Error(`Error finding user by email: ${error.message}`);
    }

    return data;
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
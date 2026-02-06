const { supabaseService } = require('../../config/supabase');

// Guest database utilities
const guestDb = {
  // Create a new guest
  create: async (guestData) => {
    const { data, error } = await supabaseService
      .from('guests')
      .insert([guestData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating guest: ${error.message}`);
    }

    return data;
  },

  // Find guest by ID
  findById: async (id) => {
    const { data, error, status } = await supabaseService
      .from('guests')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        // Cela signifie simplement que le guest n'existe pas
        return null;
      }
      // Sinon, c'est une vraie erreur technique
      throw new Error(`Error finding guest: ${error.message}`);
    }

    return data;
  },

  // Find guests by event ID
  findByEvent: async (eventId) => {
    const { data, error } = await supabaseService
      .from('guests')
      .select('*')
      .eq('event_id', eventId)
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true });

    if (error) {
      throw new Error(`Error finding guests: ${error.message}`);
    }

    return data;
  },

  // Find guest by email and event ID
  findByEmailAndEvent: async (email, eventId) => {
    const { data, error, status } = await supabaseService
      .from('guests')
      .select('*')
      .eq('email', email)
      .eq('event_id', eventId)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        // Cela signifie simplement que le guest n'existe pas
        return null;
      }
      // Sinon, c'est une vraie erreur technique
      throw new Error(`Error finding guest: ${error.message}`);
    }

    return data;
  },

  // Update guest
  update: async (id, guestData) => {
    const { data, error } = await supabaseService
      .from('guests')
      .update(guestData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating guest: ${error.message}`);
    }

    return data;
  },

  // Delete guest
  delete: async (id) => {
    const { data, error } = await supabaseService
      .from('guests')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting guest: ${error.message}`);
    }

    return data;
  }
};

module.exports = guestDb;
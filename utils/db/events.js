const { supabaseService } = require('../../config/supabase');

// Event database utilities
const eventDb = {
  // Create a new event
  create: async (eventData) => {
    console.log('[events.create] Creating event with data:', {
      title: eventData.title,
      hasDescription: !!eventData.description,
      date: eventData.date,
      organizer_id: eventData.organizer_id
    });
    
    const { data, error } = await supabaseService
      .from('events')
      .insert([eventData])
      .select()
      .single();

    if (error) {
      console.error('[events.create] Supabase error:', {
        code: error.code,
        message: error.message,
        details: error.details
      });
      throw new Error(`Error creating event: ${error.message} (code: ${error.code})`);
    }

    return data;
  },

  // Find event by ID
  findById: async (id) => {
    const { data, error, status } = await supabaseService
      .from('events')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        // Cela signifie simplement que l'événement n'existe pas
        return null;
      }
      // Sinon, c'est une vraie erreur technique
      throw new Error(`Error finding event: ${error.message}`);
    }

    return data;
  },

  // Find events by organizer ID
  findByOrganizer: async (organizerId) => {
    const { data, error } = await supabaseService
      .from('events')
      .select('*')
      .eq('organizer_id', organizerId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding events: ${error.message}`);
    }

    return data;
  },

  // Update event
  update: async (id, eventData) => {
    const { data, error } = await supabaseService
      .from('events')
      .update(eventData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating event: ${error.message}`);
    }

    return data;
  },

  // Soft delete event
  softDelete: async (id) => {
    const { data, error } = await supabaseService
      .from('events')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting event: ${error.message}`);
    }

    return data;
  }
};

module.exports = eventDb;
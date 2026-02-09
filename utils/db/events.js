const { supabaseService } = require('../../config/supabase');

// Event database utilities
const eventDb = {
  // Create a new event
  create: async (eventData) => {
    console.log('[events.create] Creating event with data:', {
      title: eventData.title,
      hasDescription: !!eventData.description,
      date: eventData.date,
      hasLocation: !!eventData.location,
      organizer_id: eventData.organizer_id,
      scheduleSteps: eventData.event_schedule?.length || 0
    });
    
    // Ensure required fields have default values
    const processedEventData = {
      title: eventData.title,
      description: eventData.description || null, // NULL est permis depuis migration
      date: eventData.date,
      location: eventData.location || null,
      organizer_id: eventData.organizer_id,
      is_active: eventData.is_active !== false, // Default true
      settings: eventData.settings || {
        enableRSVP: true,
        enableGames: false,
        enablePhotoGallery: true,
        enableGuestBook: true,
        enableQRVerification: true
      }
    };

    // Ajouter les champs optionnels s'ils existent
    if (eventData.guest_count !== undefined) {
      processedEventData.guest_count = eventData.guest_count;
    }
    if (eventData.partner1_name) {
      processedEventData.partner1_name = eventData.partner1_name;
    }
    if (eventData.partner2_name) {
      processedEventData.partner2_name = eventData.partner2_name;
    }
    if (eventData.event_schedule) {
      processedEventData.event_schedule = eventData.event_schedule;
    }
    if (eventData.cover_image) {
      processedEventData.cover_image = eventData.cover_image;
    }
    if (eventData.banner_image) {
      processedEventData.banner_image = eventData.banner_image;
    }
    
    const { data, error } = await supabaseService
      .from('events')
      .insert([processedEventData])
      .select()
      .single();

    if (error) {
      console.error('[events.create] Supabase error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      throw new Error(`Error creating event: ${error.message} (code: ${error.code})`);
    }

    console.log('[events.create] Event created successfully:', {
      id: data.id,
      title: data.title
    });

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
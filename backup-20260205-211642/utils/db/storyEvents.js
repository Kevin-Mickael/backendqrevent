const { supabaseService } = require('../../config/supabase');

// Story Events database utilities
const storyEventsDb = {
  // Create a new story event
  create: async (storyEventData) => {
    const { data, error } = await supabaseService
      .from('story_events')
      .insert([storyEventData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating story event: ${error.message}`);
    }

    return data;
  },

  // Find story event by ID
  findById: async (id) => {
    const { data, error, status } = await supabaseService
      .from('story_events')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        return null;
      }
      throw new Error(`Error finding story event: ${error.message}`);
    }

    return data;
  },

  // Find all story events by event ID
  findByEvent: async (eventId) => {
    const { data, error } = await supabaseService
      .from('story_events')
      .select('*')
      .eq('event_id', eventId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Error finding story events: ${error.message}`);
    }

    return data || [];
  },

  // Update story event
  update: async (id, storyEventData) => {
    const { data, error } = await supabaseService
      .from('story_events')
      .update(storyEventData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating story event: ${error.message}`);
    }

    return data;
  },

  // Soft delete story event
  softDelete: async (id) => {
    const { data, error } = await supabaseService
      .from('story_events')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting story event: ${error.message}`);
    }

    return data;
  },

  // Reorder story events
  reorder: async (eventId, orderedIds) => {
    // Update sort_order for each story event
    const updates = orderedIds.map((id, index) => ({
      id,
      sort_order: index
    }));

    const { data, error } = await supabaseService
      .from('story_events')
      .upsert(updates)
      .select();

    if (error) {
      throw new Error(`Error reordering story events: ${error.message}`);
    }

    return data;
  }
};

module.exports = storyEventsDb;

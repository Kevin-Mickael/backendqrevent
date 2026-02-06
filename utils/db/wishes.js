const { supabaseService } = require('../../config/supabase');

// Wishes database utilities
const wishesDb = {
  // Create a new wish
  create: async (wishData) => {
    const { data, error } = await supabaseService
      .from('wishes')
      .insert([wishData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating wish: ${error.message}`);
    }

    return data;
  },

  // Find wish by ID
  findById: async (id) => {
    const { data, error, status } = await supabaseService
      .from('wishes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        return null;
      }
      throw new Error(`Error finding wish: ${error.message}`);
    }

    return data;
  },

  // Find wishes by event ID
  findByEvent: async (eventId, options = {}) => {
    const { 
      isPublic = null, 
      isModerated = null, 
      limit = 100, 
      offset = 0,
      orderBy = 'created_at',
      orderDirection = 'desc'
    } = options;

    let query = supabaseService
      .from('wishes')
      .select('*')
      .eq('event_id', eventId);

    // Filter by public status if specified
    if (isPublic !== null) {
      query = query.eq('is_public', isPublic);
    }

    // Filter by moderated status if specified
    if (isModerated !== null) {
      query = query.eq('is_moderated', isModerated);
    }

    const { data, error } = await query
      .order(orderBy, { ascending: orderDirection === 'asc' })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Error finding wishes: ${error.message}`);
    }

    return data || [];
  },

  // Count wishes by event ID
  countByEvent: async (eventId, options = {}) => {
    const { isPublic = null, today = false } = options;

    let query = supabaseService
      .from('wishes')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId);

    if (isPublic !== null) {
      query = query.eq('is_public', isPublic);
    }

    if (today) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      query = query.gte('created_at', todayStart.toISOString());
    }

    const { count, error } = await query;

    if (error) {
      throw new Error(`Error counting wishes: ${error.message}`);
    }

    return count || 0;
  },

  // Update a wish
  update: async (id, wishData) => {
    const { data, error } = await supabaseService
      .from('wishes')
      .update(wishData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating wish: ${error.message}`);
    }

    return data;
  },

  // Delete a wish
  delete: async (id) => {
    const { data, error } = await supabaseService
      .from('wishes')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting wish: ${error.message}`);
    }

    return data;
  },

  // Moderate a wish
  moderate: async (id, moderatorId, isApproved = true) => {
    const { data, error } = await supabaseService
      .from('wishes')
      .update({
        is_moderated: true,
        moderated_by: moderatorId,
        moderated_at: new Date().toISOString(),
        is_public: isApproved
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error moderating wish: ${error.message}`);
    }

    return data;
  },

  // Get wish statistics for an event
  getStats: async (eventId) => {
    const { data, error } = await supabaseService
      .from('wishes')
      .select('is_public, is_moderated')
      .eq('event_id', eventId);

    if (error) {
      throw new Error(`Error getting wish stats: ${error.message}`);
    }

    const wishes = data || [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
      total: wishes.length,
      public: wishes.filter(w => w.is_public).length,
      private: wishes.filter(w => !w.is_public).length,
      moderated: wishes.filter(w => w.is_moderated).length,
      pendingModeration: wishes.filter(w => !w.is_moderated).length
    };
  }
};

module.exports = wishesDb;

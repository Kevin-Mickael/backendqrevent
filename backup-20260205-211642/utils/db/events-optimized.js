const { supabaseService } = require('../../config/supabase');

// ============================================
// EVENTS DB - VERSION OPTIMISÉE
// ============================================
// Optimisations:
// 1. Utilise les vues matérialisées pour les requêtes dashboard
// 2. Élimine les N+1 queries
// 3. Ajoute la pagination partout

const eventDb = {
  // Create a new event
  create: async (eventData) => {
    const { data, error } = await supabaseService
      .from('events')
      .insert([eventData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating event: ${error.message}`);
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
        return null;
      }
      throw new Error(`Error finding event: ${error.message}`);
    }

    return data;
  },

  // ============================================
  // OPTIMISATION: Dashboard avec vue matérialisée
  // ============================================
  findByOrganizerWithStats: async (organizerId, options = {}) => {
    const { page = 1, limit = 20 } = options;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Utilise la vue matérialisée au lieu de JOIN coûteux
    const { data, error, count } = await supabaseService
      .from('mv_event_summary')
      .select('*', { count: 'exact' })
      .eq('organizer_id', organizerId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Error finding events with stats: ${error.message}`);
    }

    return {
      data: data || [],
      count: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
    };
  },

  // Version legacy sans stats (pour compatibilité)
  findByOrganizer: async (organizerId, options = {}) => {
    const { page = 1, limit = 50 } = options;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabaseService
      .from('events')
      .select('*', { count: 'exact' })
      .eq('organizer_id', organizerId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Error finding events: ${error.message}`);
    }

    return {
      data: data || [],
      count: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit)
    };
  },

  // ============================================
  // OPTIMISATION: Summary dashboard en une requête
  // ============================================
  getDashboardSummary: async (organizerId) => {
    // Utilise la fonction SQL optimisée
    const { data, error } = await supabaseService
      .rpc('get_dashboard_summary', { p_organizer_id: organizerId });

    if (error) {
      // Fallback sur la vue matérialisée si la fonction échoue
      const { data: fallbackData, error: fallbackError } = await supabaseService
        .from('mv_event_summary')
        .select(`
          total_events:count(),
          total_guests:total_guests.sum(),
          confirmed_guests:confirmed_guests.sum(),
          pending_guests:pending_guests.sum(),
          declined_guests:declined_guests.sum(),
          arrived_guests:arrived_guests.sum()
        `)
        .eq('organizer_id', organizerId)
        .single();

      if (fallbackError) {
        throw new Error(`Error getting dashboard summary: ${fallbackError.message}`);
      }

      return fallbackData;
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
  },

  // ============================================
  // OPTIMISATION: Rafraîchissement vues matérialisées
  // ============================================
  refreshMaterializedViews: async () => {
    const { error } = await supabaseService.rpc('refresh_event_summary');
    if (error) {
      throw new Error(`Error refreshing materialized views: ${error.message}`);
    }
    return true;
  }
};

module.exports = eventDb;

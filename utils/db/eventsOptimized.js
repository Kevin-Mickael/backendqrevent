const { supabaseService } = require('../../config/supabase');

/**
 * 🚀 Event Database Utilities - VERSION OPTIMISÉE
 * 
 * Ces fonctions éliminent les requêtes N+1 en utilisant:
 * - Vues matérialisées
 * - Requêtes agrégées
 * - Caching
 */

const eventDbOptimized = {
  // ============================================
  // LECTURES OPTIMISÉES
  // ============================================

  /**
   * 🔥 Récupère les événements avec stats en UNE SEULE requête
   * Élimine le N+1 de l'ancienne implementation
   * 
   * @param {UUID} organizerId - ID de l'organisateur
   * @param {Object} options - Options de pagination
   * @returns {Promise<Array>} Events avec stats pré-calculées
   */
  findByOrganizerWithStats: async (organizerId, { page = 1, limit = 50 } = {}) => {
    try {
      // Utilise la vue matérialisée mv_event_summary
      const { data, error, count } = await supabaseService
        .from('mv_event_summary')
        .select('*', { count: 'exact' })
        .eq('organizer_id', organizerId)
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (error) {
        throw new Error(`Error fetching events with stats: ${error.message}`);
      }

      // Formater pour compatibilité avec l'ancien format
      const formatted = data.map(event => ({
        id: event.event_id,
        title: event.title,
        date: event.date,
        is_active: event.is_active,
        created_at: event.created_at,
        // Stats pré-calculées
        stats: {
          totalGuests: event.total_guests,
          confirmed: event.confirmed_guests,
          declined: event.declined_guests,
          pending: event.pending_guests,
          arrived: event.arrived_guests,
          left: event.left_guests
        }
      }));

      return {
        events: formatted,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      console.error('Error in findByOrganizerWithStats:', error);
      throw error;
    }
  },

  /**
   * 🔥 Dashboard summary en une requête (remplace N+1)
   * Utilise la fonction SQL get_dashboard_summary
   * 
   * @param {UUID} organizerId - ID de l'organisateur
   * @returns {Promise<Object>} Résumé du dashboard
   */
  getDashboardSummary: async (organizerId) => {
    try {
      const { data, error } = await supabaseService
        .rpc('get_dashboard_summary', {
          p_organizer_id: organizerId
        });

      if (error) {
        // Fallback si la fonction n'existe pas encore
        console.warn('RPC not available, using fallback:', error.message);
        return eventDbOptimized.getDashboardSummaryFallback(organizerId);
      }

      return data?.[0] || {
        total_events: 0,
        total_guests: 0,
        confirmed_guests: 0,
        pending_guests: 0,
        declined_guests: 0,
        arrived_guests: 0
      };
    } catch (error) {
      console.error('Error in getDashboardSummary:', error);
      return eventDbOptimized.getDashboardSummaryFallback(organizerId);
    }
  },

  /**
   * Fallback si la fonction RPC n'est pas disponible
   * Utilise la vue matérialisée directement
   */
  getDashboardSummaryFallback: async (organizerId) => {
    const { data, error } = await supabaseService
      .from('mv_event_summary')
      .select('total_guests, confirmed_guests, pending_guests, declined_guests, arrived_guests')
      .eq('organizer_id', organizerId);

    if (error) {
      throw new Error(`Error in dashboard fallback: ${error.message}`);
    }

    return data.reduce((acc, event) => ({
      total_events: data.length,
      total_guests: acc.total_guests + (event.total_guests || 0),
      confirmed_guests: acc.confirmed_guests + (event.confirmed_guests || 0),
      pending_guests: acc.pending_guests + (event.pending_guests || 0),
      declined_guests: acc.declined_guests + (event.declined_guests || 0),
      arrived_guests: acc.arrived_guests + (event.arrived_guests || 0)
    }), {
      total_events: 0,
      total_guests: 0,
      confirmed_guests: 0,
      pending_guests: 0,
      declined_guests: 0,
      arrived_guests: 0
    });
  },

  /**
   * 🔥 Récupère un événement avec tous ses guests (évite N+1)
   * Utilise une jointure Supabase
   * 
   * @param {UUID} eventId - ID de l'événement
   * @returns {Promise<Object>} Event avec guests inclus
   */
  findByIdWithGuests: async (eventId) => {
    const { data: event, error: eventError } = await supabaseService
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (eventError) {
      if (eventError.code === 'PGRST116') return null;
      throw new Error(`Error finding event: ${eventError.message}`);
    }

    // Récupère tous les guests en une requête
    const { data: guests, error: guestsError } = await supabaseService
      .from('guests')
      .select('*')
      .eq('event_id', eventId)
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true });

    if (guestsError) {
      throw new Error(`Error finding guests: ${guestsError.message}`);
    }

    return {
      ...event,
      guests: guests || [],
      guestCount: guests?.length || 0
    };
  },

  // ============================================
  // PAGINATION
  // ============================================

  /**
   * Récupère les événements paginés
   * 
   * @param {UUID} organizerId - ID de l'organisateur
   * @param {Object} options - Options de pagination
   * @returns {Promise<Object>} Events paginés
   */
  findByOrganizerPaginated: async (organizerId, { 
    page = 1, 
    limit = 20,
    sortBy = 'created_at',
    sortOrder = 'desc'
  } = {}) => {
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseService
      .from('events')
      .select('*', { count: 'exact' })
      .eq('organizer_id', organizerId)
      .eq('is_active', true)
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Error fetching paginated events: ${error.message}`);
    }

    return {
      events: data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
        hasNext: page * limit < count,
        hasPrev: page > 1
      }
    };
  },

  // ============================================
  // CACHE MANAGEMENT
  // ============================================

  /**
   * Rafraîchit la vue matérialisée des événements
   * À appeler après des modifications massives
   */
  refreshMaterializedView: async () => {
    const { error } = await supabaseService
      .rpc('refresh_event_summary');

    if (error) {
      throw new Error(`Error refreshing materialized view: ${error.message}`);
    }

    return { success: true };
  }
};

module.exports = eventDbOptimized;

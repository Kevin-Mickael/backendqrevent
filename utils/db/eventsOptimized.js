const { supabaseService } = require('../../config/supabase');

/**
 * 🚀 Event Database Utilities - VERSION OPTIMISÉE
 * 
 * Ces fonctions éliminent les requêtes N+1 en utilisant:
 * - Requêtes agrégées standard
 * - Caching
 */

const eventDbOptimized = {
  // ============================================
  // LECTURES OPTIMISÉES
  // ============================================

  /**
   * 🔥 Récupère les événements avec stats
   * Utilise des requêtes standards compatibles avec toutes les BDD
   * 
   * @param {UUID} organizerId - ID de l'organisateur
   * @param {Object} options - Options de pagination
   * @returns {Promise<Array>} Events avec stats
   */
  findByOrganizerWithStats: async (organizerId, { page = 1, limit = 50 } = {}) => {
    try {
      // Récupère les événements de l'organisateur
      const { data: events, error: eventsError, count } = await supabaseService
        .from('events')
        .select('*', { count: 'exact' })
        .eq('organizer_id', organizerId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (eventsError) {
        throw new Error(`Error fetching events: ${eventsError.message}`);
      }

      if (!events || events.length === 0) {
        return {
          events: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0
          }
        };
      }

      // Récupère les stats des guests pour tous les événements en une requête
      const eventIds = events.map(e => e.id);
      const { data: guestStats, error: statsError } = await supabaseService
        .from('guests')
        .select('event_id, rsvp_status, attendance_status')
        .in('event_id', eventIds);

      if (statsError) {
        console.warn('Could not fetch guest stats:', statsError.message);
      }

      // Calcule les stats par événement
      const statsByEvent = {};
      eventIds.forEach(id => {
        statsByEvent[id] = {
          totalGuests: 0,
          confirmed: 0,
          declined: 0,
          pending: 0,
          arrived: 0,
          left: 0
        };
      });

      if (guestStats) {
        guestStats.forEach(guest => {
          if (statsByEvent[guest.event_id]) {
            statsByEvent[guest.event_id].totalGuests++;
            
            if (guest.rsvp_status === 'accepted') {
              statsByEvent[guest.event_id].confirmed++;
            } else if (guest.rsvp_status === 'declined') {
              statsByEvent[guest.event_id].declined++;
            } else {
              statsByEvent[guest.event_id].pending++;
            }

            if (guest.attendance_status === 'arrived') {
              statsByEvent[guest.event_id].arrived++;
            } else if (guest.attendance_status === 'left') {
              statsByEvent[guest.event_id].left++;
            }
          }
        });
      }

      // Formater pour compatibilité
      const formatted = events.map(event => ({
        id: event.id,
        title: event.title,
        date: event.date,
        is_active: event.is_active,
        created_at: event.created_at,
        location: event.location,
        cover_image: event.cover_image,
        banner_image: event.banner_image,
        settings: event.settings,
        // Stats calculées
        stats: statsByEvent[event.id] || {
          totalGuests: 0,
          confirmed: 0,
          declined: 0,
          pending: 0,
          arrived: 0,
          left: 0
        }
      }));

      return {
        events: formatted,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        }
      };
    } catch (error) {
      console.error('Error in findByOrganizerWithStats:', error);
      throw error;
    }
  },

  /**
   * 🔥 Dashboard summary en requêtes optimisées
   * 
   * @param {UUID} organizerId - ID de l'organisateur
   * @returns {Promise<Object>} Résumé du dashboard
   */
  getDashboardSummary: async (organizerId) => {
    try {
      // Compte les événements
      const { count: totalEvents, error: eventsError } = await supabaseService
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('organizer_id', organizerId)
        .eq('is_active', true);

      if (eventsError) {
        throw eventsError;
      }

      // Récupère tous les guests de tous les événements de l'organisateur
      const { data: events, error: eventsListError } = await supabaseService
        .from('events')
        .select('id')
        .eq('organizer_id', organizerId)
        .eq('is_active', true);

      if (eventsListError) {
        throw eventsListError;
      }

      if (!events || events.length === 0) {
        return {
          total_events: 0,
          total_guests: 0,
          confirmed_guests: 0,
          pending_guests: 0,
          declined_guests: 0,
          arrived_guests: 0
        };
      }

      const eventIds = events.map(e => e.id);

      // Récupère les stats des guests
      const { data: guests, error: guestsError } = await supabaseService
        .from('guests')
        .select('rsvp_status, attendance_status')
        .in('event_id', eventIds);

      if (guestsError) {
        throw guestsError;
      }

      // Calcule les stats
      const stats = (guests || []).reduce((acc, guest) => {
        acc.total_guests++;
        
        if (guest.rsvp_status === 'accepted') {
          acc.confirmed_guests++;
        } else if (guest.rsvp_status === 'declined') {
          acc.declined_guests++;
        } else {
          acc.pending_guests++;
        }

        if (guest.attendance_status === 'arrived') {
          acc.arrived_guests++;
        }

        return acc;
      }, {
        total_events: totalEvents || 0,
        total_guests: 0,
        confirmed_guests: 0,
        pending_guests: 0,
        declined_guests: 0,
        arrived_guests: 0
      });

      return stats;
    } catch (error) {
      console.error('Error in getDashboardSummary:', error);
      // Retourne des valeurs par défaut en cas d'erreur
      return {
        total_events: 0,
        total_guests: 0,
        confirmed_guests: 0,
        pending_guests: 0,
        declined_guests: 0,
        arrived_guests: 0
      };
    }
  },

  /**
   * 🔥 Récupère un événement avec tous ses guests
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
   * Rafraîchit les données (noop pour compatibilité)
   */
  refreshMaterializedView: async () => {
    // Pas de vue matérialisée à rafraîchir
    return { success: true };
  }
};

module.exports = eventDbOptimized;

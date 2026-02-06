const { supabaseService } = require('../../config/supabase');

/**
 * 🚀 Event Database Utilities - VERSION CORRIGÉE
 * 
 * Correction des erreurs RPC Supabase :
 * - Fonctions PostgreSQL manquantes 
 * - Types incompatibles
 * - Fallbacks robustes
 */

const eventDbOptimized = {
  // ============================================
  // LECTURES OPTIMISÉES AVEC FALLBACKS
  // ============================================

  /**
   * 🔥 Récupère les événements avec stats en UNE SEULE requête
   * CORRIGÉ: Utilise fallback si vue matérialisée n'existe pas
   * 
   * @param {UUID} organizerId - ID de l'organisateur
   * @param {Object} options - Options de pagination
   * @returns {Promise<Array>} Events avec stats pré-calculées
   */
  findByOrganizerWithStats: async (organizerId, { page = 1, limit = 50 } = {}) => {
    try {
      // Essayer d'abord la vue matérialisée
      const { data, error, count } = await supabaseService
        .from('mv_event_summary')
        .select('*', { count: 'exact' })
        .eq('organizer_id', organizerId)
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (error) {
        // Fallback: requête normale avec jointures
        console.warn('Materialized view not available, using fallback query');
        return await this.findByOrganizerWithStatsFallback(organizerId, { page, limit });
      }

      // Formater pour compatibilité avec l'ancien format
      const formatted = data.map(event => ({
        id: event.event_id || event.id,
        title: event.title,
        date: event.date,
        is_active: event.is_active,
        created_at: event.created_at,
        // Stats pré-calculées
        stats: {
          totalGuests: event.total_guests || 0,
          confirmed: event.confirmed_guests || 0,
          declined: event.declined_guests || 0,
          pending: event.pending_guests || 0,
          arrived: event.arrived_guests || 0,
          left: event.left_guests || 0
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
      // Fallback final
      return await this.findByOrganizerWithStatsFallback(organizerId, { page, limit });
    }
  },

  /**
   * Fallback robuste si la vue matérialisée n'existe pas
   */
  findByOrganizerWithStatsFallback: async (organizerId, { page = 1, limit = 50 } = {}) => {
    try {
      // 1. Récupérer les événements
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

      // 2. Pour chaque événement, calculer les stats
      const eventsWithStats = await Promise.all(
        events.map(async (event) => {
          // Compter les invités par statut
          const { data: guestStats, error: statsError } = await supabaseService
            .from('guests')
            .select('status')
            .eq('event_id', event.id);

          const stats = {
            totalGuests: 0,
            confirmed: 0,
            declined: 0,
            pending: 0,
            arrived: 0,
            left: 0
          };

          if (!statsError && guestStats) {
            stats.totalGuests = guestStats.length;
            stats.confirmed = guestStats.filter(g => g.status === 'confirmed').length;
            stats.declined = guestStats.filter(g => g.status === 'declined').length;
            stats.pending = guestStats.filter(g => g.status === 'pending').length;
            stats.arrived = guestStats.filter(g => g.status === 'arrived').length;
            stats.left = guestStats.filter(g => g.status === 'left').length;
          }

          return {
            ...event,
            stats
          };
        })
      );

      return {
        events: eventsWithStats,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil((count || 0) / limit)
        }
      };
    } catch (error) {
      console.error('Error in fallback query:', error);
      throw error;
    }
  },

  /**
   * 🔥 Dashboard summary CORRIGÉ avec validation des paramètres
   * 
   * @param {UUID} organizerId - ID de l'organisateur
   * @returns {Promise<Object>} Résumé du dashboard
   */
  getDashboardSummary: async (organizerId) => {
    // Validation des paramètres
    if (!organizerId || typeof organizerId !== 'string') {
      throw new Error('Invalid organizer ID provided');
    }

    try {
      // Essayer la fonction RPC avec paramètres corrects
      const { data, error } = await supabaseService.rpc('get_dashboard_summary', {
        p_organizer_id: organizerId
      });

      if (error) {
        // Log l'erreur spécifique et utiliser le fallback
        console.warn('RPC function not available or failed:', error.message);
        console.warn('Error details:', {
          code: error.code,
          hint: error.hint,
          details: error.details
        });
        
        return await this.getDashboardSummaryFallback(organizerId);
      }

      // Valider le format de la réponse
      const result = Array.isArray(data) ? data[0] : data;
      
      return {
        total_events: result?.total_events || 0,
        total_guests: result?.total_guests || 0,
        confirmed_guests: result?.confirmed_guests || 0,
        pending_guests: result?.pending_guests || 0,
        declined_guests: result?.declined_guests || 0,
        arrived_guests: result?.arrived_guests || 0
      };
    } catch (error) {
      console.error('Error in getDashboardSummary:', error);
      return await this.getDashboardSummaryFallback(organizerId);
    }
  },

  /**
   * Fallback corrigé pour le dashboard summary
   */
  getDashboardSummaryFallback: async (organizerId) => {
    try {
      // 1. Compter les événements
      const { count: eventsCount, error: eventsError } = await supabaseService
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('organizer_id', organizerId)
        .eq('is_active', true);

      if (eventsError) {
        throw new Error(`Error counting events: ${eventsError.message}`);
      }

      // 2. Récupérer tous les événements pour compter les invités
      const { data: events, error: eventDataError } = await supabaseService
        .from('events')
        .select('id')
        .eq('organizer_id', organizerId)
        .eq('is_active', true);

      if (eventDataError || !events) {
        throw new Error(`Error fetching events: ${eventDataError?.message || 'No data'}`);
      }

      if (events.length === 0) {
        return {
          total_events: 0,
          total_guests: 0,
          confirmed_guests: 0,
          pending_guests: 0,
          declined_guests: 0,
          arrived_guests: 0
        };
      }

      // 3. Compter les invités par statut pour tous les événements
      const eventIds = events.map(e => e.id);
      
      const { data: allGuests, error: guestsError } = await supabaseService
        .from('guests')
        .select('status')
        .in('event_id', eventIds);

      if (guestsError) {
        throw new Error(`Error fetching guests: ${guestsError.message}`);
      }

      const guestStats = {
        total_events: eventsCount || 0,
        total_guests: allGuests?.length || 0,
        confirmed_guests: 0,
        pending_guests: 0,
        declined_guests: 0,
        arrived_guests: 0
      };

      if (allGuests) {
        guestStats.confirmed_guests = allGuests.filter(g => g.status === 'confirmed').length;
        guestStats.pending_guests = allGuests.filter(g => g.status === 'pending').length;
        guestStats.declined_guests = allGuests.filter(g => g.status === 'declined').length;
        guestStats.arrived_guests = allGuests.filter(g => g.status === 'arrived').length;
      }

      return guestStats;

    } catch (error) {
      console.error('Error in dashboard fallback:', error);
      // Retourner des valeurs par défaut plutôt que de faire échouer
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
   * 🔥 Récupère un événement avec tous ses guests (corrigé)
   */
  findByIdWithGuests: async (eventId) => {
    if (!eventId) {
      throw new Error('Event ID is required');
    }

    try {
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

      // Ne pas faire échouer si les invités ne peuvent pas être récupérés
      if (guestsError) {
        console.warn(`Warning: Could not fetch guests for event ${eventId}:`, guestsError.message);
      }

      return {
        ...event,
        guests: guests || [],
        guestCount: guests?.length || 0
      };
    } catch (error) {
      console.error('Error in findByIdWithGuests:', error);
      throw error;
    }
  },

  // ============================================
  // REFRESH FUNCTIONS - CORRIGÉES
  // ============================================

  /**
   * Rafraîchit la vue matérialisée avec validation
   */
  refreshMaterializedView: async () => {
    try {
      // Vérifier d'abord si la fonction RPC existe
      const { data, error } = await supabaseService.rpc('refresh_event_summary');

      if (error) {
        console.warn('RPC refresh function not available:', error.message);
        
        // Fallback : essayer de rafraîchir directement via SQL
        return await this.refreshMaterializedViewDirect();
      }

      return { success: true, method: 'rpc' };
    } catch (error) {
      console.error('Error refreshing materialized view:', error);
      // Fallback final
      return await this.refreshMaterializedViewDirect();
    }
  },

  /**
   * Rafraîchissement direct via SQL brut
   */
  refreshMaterializedViewDirect: async () => {
    try {
      // Essayer d'exécuter le SQL directement
      const { error } = await supabaseService.rpc('exec_sql', {
        query: 'REFRESH MATERIALIZED VIEW IF EXISTS mv_event_summary'
      });

      if (error) {
        console.warn('Direct refresh not available, manual intervention required');
        return { 
          success: false, 
          error: error.message,
          message: 'Manual refresh required via Supabase Dashboard'
        };
      }

      return { success: true, method: 'direct' };
    } catch (error) {
      console.error('Error in direct refresh:', error);
      return { 
        success: false, 
        error: error.message,
        message: 'Refresh functionality not available'
      };
    }
  }
};

module.exports = eventDbOptimized;
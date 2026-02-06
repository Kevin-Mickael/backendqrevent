/**
 * 🚀 ROUTES API OPTIMISÉES
 * 
 * Ce fichier remplace les routes lentes par des versions optimisées
 * qui éliminent les requêtes N+1 et utilisent les vues matérialisées.
 * 
 * À intégrer dans api.js ou remplacer les routes existantes.
 */

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { dashboardLimiter } = require('../middleware/security.db');
const eventsOptimized = require('../utils/db/eventsOptimized');

const router = express.Router();

// ============================================
// 🔥 ROUTE OPTIMISÉE: GET /api/invitations
// ============================================
// Ancien problème: N+1 - 1 requête par événement
// Nouveau: 1 requête total avec vue matérialisée

router.get('/invitations-optimized', authenticateToken, dashboardLimiter, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    // 🚀 Utilise la vue matérialisée - PAS DE N+1
    const { events, pagination } = await eventsOptimized.findByOrganizerWithStats(
      req.user.id, 
      { page, limit }
    );

    // Formater pour compatibilité avec le frontend
    const invitations = events.map(event => ({
      id: event.id,
      name: event.title,
      template: event.settings?.template || 'Dentelle Royale',
      status: getEventStatus(event),
      views: 0, // À implémenter avec analytics
      responses: event.stats.totalGuests,
      confirmed: event.stats.confirmed,
      declined: event.stats.declined,
      pending: event.stats.pending,
      date: new Date(event.date).toLocaleDateString('fr-FR', { 
        day: '2-digit', 
        month: 'short' 
      }),
      fullDate: event.date,
      location: event.location,
      coverImage: event.cover_image,
      bannerImage: event.banner_image,
      settings: event.settings
    }));

    res.json({
      success: true,
      data: invitations,
      pagination,
      count: invitations.length,
      optimized: true // Flag pour debugging
    });
  } catch (error) {
    console.error('Error fetching optimized invitations:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching invitations'
    });
  }
});

// ============================================
// 🔥 ROUTE OPTIMISÉE: GET /api/dashboard/summary
// ============================================
// Ancien problème: Multiple requêtes séquentielles
// Nouveau: 1 requête RPC ou vue matérialisée

router.get('/dashboard/summary-optimized', authenticateToken, dashboardLimiter, async (req, res) => {
  try {
    // 🚀 Utilise la fonction SQL ou vue matérialisée
    const summary = await eventsOptimized.getDashboardSummary(req.user.id);

    // Récupérer le dernier événement pour les détails
    const { events } = await eventsOptimized.findByOrganizerWithStats(
      req.user.id, 
      { page: 1, limit: 1 }
    );

    const latestEvent = events[0];

    res.json({
      success: true,
      data: {
        totalEvents: summary.total_events,
        latestEvent: latestEvent ? {
          id: latestEvent.id,
          title: latestEvent.title,
          date: latestEvent.date,
          coverImage: latestEvent.cover_image
        } : null,
        stats: {
          totalGuests: summary.total_guests,
          confirmed: summary.confirmed_guests,
          pending: summary.pending_guests,
          declined: summary.declined_guests,
          arrived: summary.arrived_guests
        },
        recentActivity: [] // À implémenter si nécessaire
      },
      optimized: true
    });
  } catch (error) {
    console.error('Error fetching optimized dashboard summary:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching dashboard summary'
    });
  }
});

// ============================================
// 🔥 ROUTE OPTIMISÉE: GET /api/events/:eventId
// ============================================
// Avec guests inclus en une requête

router.get('/events/:eventId/optimized', authenticateToken, async (req, res) => {
  try {
    const event = await eventsOptimized.findByIdWithGuests(req.params.eventId);

    if (!event || event.organizer_id !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    res.json({
      success: true,
      data: event,
      optimized: true
    });
  } catch (error) {
    console.error('Error fetching optimized event:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching event'
    });
  }
});

// ============================================
// HELPERS
// ============================================

function getEventStatus(event) {
  if (!event.is_active) return 'draft';
  const eventDate = new Date(event.date);
  const now = new Date();
  return eventDate > now ? 'published' : 'completed';
}

// ============================================
// ENDPOINTS DE MAINTENANCE (Admin seulement)
// ============================================

const { authorizeRole } = require('../middleware/auth');

router.post('/admin/refresh-materialized-views', 
  authenticateToken, 
  authorizeRole('admin'),
  async (req, res) => {
    try {
      await eventsOptimized.refreshMaterializedView();
      res.json({
        success: true,
        message: 'Materialized views refreshed successfully'
      });
    } catch (error) {
      console.error('Error refreshing materialized views:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to refresh materialized views'
      });
    }
  }
);

module.exports = router;

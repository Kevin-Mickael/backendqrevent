const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { 
  userProfileCache, 
  eventsListCache, 
  eventDetailsCache,
  dashboardStatsCache, 
  familiesCache,
  invitationsCache,
  autoInvalidateCache 
} = require('../middleware/cacheMiddleware');
const { dashboardLimiter } = require('../middleware/security');

const router = express.Router();

// ============================================
// 🚀 ROUTES OPTIMISÉES AVEC CACHE INTELLIGENT
// ============================================

/**
 * Routes GET avec cache automatique
 * - Cache intelligent multi-niveau
 * - Invalidation automatique sur mutations
 * - Rate limiting adaptatif
 */

// Profile utilisateur avec cache
router.get('/profile', 
  authenticateToken, 
  userProfileCache, 
  require('../controllers/authController').getProfile
);

// Liste des événements avec cache
router.get('/events', 
  authenticateToken, 
  dashboardLimiter,
  eventsListCache, 
  async (req, res) => {
    try {
      const { users, events } = require('../utils/database');
      
      const userEvents = await events.findByUserId(req.user.id);
      
      res.json({
        success: true,
        data: userEvents,
        cached: false // Sera true si servi depuis le cache
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch events'
      });
    }
  }
);

// Détails d'un événement avec cache
router.get('/events/:id', 
  authenticateToken, 
  eventDetailsCache,
  async (req, res) => {
    try {
      const { events } = require('../utils/database');
      
      const event = await events.findById(req.params.id);
      
      if (!event || event.user_id !== req.user.id) {
        return res.status(404).json({
          success: false,
          message: 'Event not found'
        });
      }
      
      res.json({
        success: true,
        data: event
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch event details'
      });
    }
  }
);

// Statistiques dashboard avec cache
router.get('/dashboard/stats/:eventId?', 
  authenticateToken,
  dashboardLimiter,
  dashboardStatsCache,
  async (req, res) => {
    try {
      const { events, families, guests } = require('../utils/database');
      const eventId = req.params.eventId;
      
      let stats = {};
      
      if (eventId) {
        // Stats pour un événement spécifique
        const event = await events.findById(eventId);
        const eventFamilies = await families.findByEventId(eventId);
        const eventGuests = await guests.findByEventId(eventId);
        
        stats = {
          event: event.title,
          totalFamilies: eventFamilies.length,
          totalGuests: eventGuests.length,
          confirmedGuests: eventGuests.filter(g => g.status === 'confirmed').length,
          pendingInvitations: eventGuests.filter(g => g.status === 'pending').length
        };
      } else {
        // Stats générales
        const userEvents = await events.findByUserId(req.user.id);
        const allFamilies = await families.findByUserId(req.user.id);
        
        stats = {
          totalEvents: userEvents.length,
          totalFamilies: allFamilies.length,
          activeEvents: userEvents.filter(e => new Date(e.date) > new Date()).length
        };
      }
      
      res.json({
        success: true,
        data: stats,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch dashboard stats'
      });
    }
  }
);

// Familles avec cache
router.get('/families', 
  authenticateToken,
  dashboardLimiter,
  familiesCache,
  async (req, res) => {
    try {
      const { families } = require('../utils/database');
      const eventId = req.query.eventId;
      
      let familyData;
      if (eventId) {
        familyData = await families.findByEventId(eventId);
      } else {
        familyData = await families.findByUserId(req.user.id);
      }
      
      res.json({
        success: true,
        data: familyData
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch families'
      });
    }
  }
);

// Invitations avec cache
router.get('/invitations', 
  authenticateToken,
  dashboardLimiter,
  invitationsCache,
  async (req, res) => {
    try {
      const { familyInvitations } = require('../utils/database');
      const eventId = req.query.eventId;
      
      let invitations;
      if (eventId) {
        invitations = await familyInvitations.findByEventId(eventId);
      } else {
        invitations = await familyInvitations.findByUserId(req.user.id);
      }
      
      res.json({
        success: true,
        data: invitations
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch invitations'
      });
    }
  }
);

// ============================================
// 🔄 ROUTES DE MUTATION AVEC INVALIDATION AUTO
// ============================================

// Création événement avec invalidation cache
router.post('/events', 
  authenticateToken,
  autoInvalidateCache('event_update'),
  async (req, res) => {
    try {
      const { events } = require('../utils/database');
      
      const newEvent = await events.create({
        ...req.body,
        user_id: req.user.id
      });
      
      res.json({
        success: true,
        data: newEvent
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to create event'
      });
    }
  }
);

// Mise à jour événement avec invalidation cache
router.put('/events/:id', 
  authenticateToken,
  autoInvalidateCache('event_update'),
  async (req, res) => {
    try {
      const { events } = require('../utils/database');
      
      const updatedEvent = await events.update(req.params.id, req.body);
      
      res.json({
        success: true,
        data: updatedEvent
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update event'
      });
    }
  }
);

// Création famille avec invalidation cache
router.post('/families', 
  authenticateToken,
  autoInvalidateCache('family_update'),
  async (req, res) => {
    try {
      const { families } = require('../utils/database');
      
      const newFamily = await families.create({
        ...req.body,
        user_id: req.user.id
      });
      
      res.json({
        success: true,
        data: newFamily
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to create family'
      });
    }
  }
);

// Mise à jour profil avec invalidation cache
router.put('/profile', 
  authenticateToken,
  autoInvalidateCache('user_update'),
  require('../controllers/authController').updateProfile
);

module.exports = router;
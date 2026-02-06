const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { authenticateToken } = require('../middleware/auth');
const { dashboardLimiter } = require('../middleware/security');
const seatingTables = require('../utils/db/seatingTables.fixed');
const logger = require('../utils/logger');

/**
 * 🔧 ROUTES SEATING TABLES - VERSION CORRIGÉE
 * 
 * Corrections selon rules.md et context.md :
 * - Validation stricte côté serveur
 * - Gestion d'erreurs uniforme
 * - Logging pour audit
 * - Rate limiting adaptatif
 * - Transactions atomiques
 * - Cohérence frontend/backend
 */

const router = express.Router();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const seatingTableValidation = {
  create: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      eventId: Joi.string().uuid().required()
    }),
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().trim().min(1).max(100).required(),
      seats: Joi.number().integer().min(1).max(50).required(),
      table_shape: Joi.string().valid('round', 'rectangular', 'square', 'oval').optional(),
      position_x: Joi.number().integer().min(-1000).max(1000).optional(),
      position_y: Joi.number().integer().min(-1000).max(1000).optional(),
      notes: Joi.string().trim().max(1000).optional().allow('')
    })
  }),

  update: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      eventId: Joi.string().uuid().required(),
      tableId: Joi.string().uuid().required()
    }),
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().trim().min(1).max(100).optional(),
      seats: Joi.number().integer().min(1).max(50).optional(),
      table_shape: Joi.string().valid('round', 'rectangular', 'square', 'oval').optional(),
      position_x: Joi.number().integer().min(-1000).max(1000).optional(),
      position_y: Joi.number().integer().min(-1000).max(1000).optional(),
      notes: Joi.string().trim().max(1000).optional().allow('')
    }).min(1)
  }),

  eventParams: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      eventId: Joi.string().uuid().required()
    })
  }),

  tableParams: celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      eventId: Joi.string().uuid().required(),
      tableId: Joi.string().uuid().required()
    })
  })
};

// ============================================
// MIDDLEWARE DE GESTION D'ERREURS STANDARDISÉ
// ============================================

const handleError = (res, error, operation) => {
  const userId = res.req?.user?.id || 'anonymous';
  
  logger.error(`Seating tables error in ${operation}`, {
    userId,
    error: error.message,
    stack: error.stack
  });

  // Déterminer le code de statut selon le type d'erreur
  let statusCode = 500;
  let message = 'Internal server error';

  if (error.message.includes('not found') || error.message.includes('access denied')) {
    statusCode = 404;
    message = 'Resource not found or access denied';
  } else if (error.message.includes('validation') || error.message.includes('invalid')) {
    statusCode = 400;
    message = error.message;
  } else if (error.message.includes('permission') || error.message.includes('unauthorized')) {
    statusCode = 403;
    message = 'Permission denied';
  } else if (error.message.includes('Maximum number')) {
    statusCode = 409;
    message = error.message;
  }

  return res.status(statusCode).json({
    success: false,
    message,
    timestamp: new Date().toISOString(),
    operation
  });
};

// ============================================
// ROUTES PRINCIPALES
// ============================================

/**
 * GET /api/events/:eventId/seating-tables
 * Récupérer toutes les tables d'un événement
 */
router.get('/events/:eventId/seating-tables', 
  authenticateToken,
  dashboardLimiter,
  seatingTableValidation.eventParams,
  async (req, res) => {
    try {
      const tables = await seatingTables.findByEvent(req.params.eventId, req.user.id);
      
      res.json({
        success: true,
        data: tables,
        count: tables.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return handleError(res, error, 'fetch_tables');
    }
  }
);

/**
 * GET /api/events/:eventId/seating-tables/unassigned-guests
 * Récupérer les invités non assignés - VERSION CORRIGÉE
 */
router.get('/events/:eventId/seating-tables/unassigned-guests',
  authenticateToken,
  dashboardLimiter,
  seatingTableValidation.eventParams,
  async (req, res) => {
    try {
      const unassignedGuests = await seatingTables.getUnassignedGuests(req.params.eventId, req.user.id);
      
      res.json({
        success: true,
        data: unassignedGuests,
        count: unassignedGuests.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return handleError(res, error, 'fetch_unassigned_guests');
    }
  }
);

/**
 * GET /api/events/:eventId/seating-tables/available-families
 * Récupérer les familles disponibles
 */
router.get('/events/:eventId/seating-tables/available-families',
  authenticateToken,
  dashboardLimiter,
  seatingTableValidation.eventParams,
  async (req, res) => {
    try {
      const availableFamilies = await seatingTables.getAvailableFamilies(req.params.eventId, req.user.id);
      
      res.json({
        success: true,
        data: availableFamilies,
        count: availableFamilies.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return handleError(res, error, 'fetch_available_families');
    }
  }
);

/**
 * GET /api/events/:eventId/seating-tables/stats
 * Récupérer les statistiques des tables
 */
router.get('/events/:eventId/seating-tables/stats',
  authenticateToken,
  dashboardLimiter,
  seatingTableValidation.eventParams,
  async (req, res) => {
    try {
      const stats = await seatingTables.getStats(req.params.eventId, req.user.id);
      
      res.json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return handleError(res, error, 'fetch_stats');
    }
  }
);

/**
 * GET /api/events/:eventId/seating-tables/:tableId
 * Récupérer une table spécifique
 */
router.get('/events/:eventId/seating-tables/:tableId',
  authenticateToken,
  dashboardLimiter,
  seatingTableValidation.tableParams,
  async (req, res) => {
    try {
      const table = await seatingTables.findById(req.params.tableId, req.user.id);
      
      if (!table) {
        return res.status(404).json({
          success: false,
          message: 'Seating table not found',
          timestamp: new Date().toISOString()
        });
      }
      
      res.json({
        success: true,
        data: table,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return handleError(res, error, 'fetch_table');
    }
  }
);

/**
 * POST /api/events/:eventId/seating-tables
 * Créer une nouvelle table
 */
router.post('/events/:eventId/seating-tables',
  authenticateToken,
  dashboardLimiter,
  seatingTableValidation.create,
  async (req, res) => {
    try {
      const tableData = {
        ...req.body,
        event_id: req.params.eventId
      };

      const newTable = await seatingTables.create(tableData, req.user.id);
      
      res.status(201).json({
        success: true,
        data: newTable,
        message: 'Seating table created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return handleError(res, error, 'create_table');
    }
  }
);

/**
 * PUT /api/events/:eventId/seating-tables/:tableId
 * Mettre à jour une table
 */
router.put('/events/:eventId/seating-tables/:tableId',
  authenticateToken,
  dashboardLimiter,
  seatingTableValidation.update,
  async (req, res) => {
    try {
      const updatedTable = await seatingTables.update(req.params.tableId, req.body, req.user.id);
      
      res.json({
        success: true,
        data: updatedTable,
        message: 'Seating table updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return handleError(res, error, 'update_table');
    }
  }
);

/**
 * DELETE /api/events/:eventId/seating-tables/:tableId
 * Supprimer une table
 */
router.delete('/events/:eventId/seating-tables/:tableId',
  authenticateToken,
  dashboardLimiter,
  seatingTableValidation.tableParams,
  async (req, res) => {
    try {
      const deletedTable = await seatingTables.delete(req.params.tableId, req.user.id);
      
      res.json({
        success: true,
        data: deletedTable,
        message: 'Seating table deleted successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return handleError(res, error, 'delete_table');
    }
  }
);

// ============================================
// ROUTES D'ASSIGNATION (FUTURES)
// ============================================

/**
 * POST /api/events/:eventId/seating-tables/:tableId/assign-guest
 * Assigner un invité à une table
 */
router.post('/events/:eventId/seating-tables/:tableId/assign-guest',
  authenticateToken,
  dashboardLimiter,
  celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      eventId: Joi.string().uuid().required(),
      tableId: Joi.string().uuid().required()
    }),
    [Segments.BODY]: Joi.object().keys({
      guest_id: Joi.string().uuid().required(),
      seat_number: Joi.number().integer().min(1).optional()
    })
  }),
  async (req, res) => {
    try {
      // TODO: Implémenter l'assignation d'invité
      res.status(501).json({
        success: false,
        message: 'Guest assignment not yet implemented',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return handleError(res, error, 'assign_guest');
    }
  }
);

/**
 * POST /api/events/:eventId/seating-tables/:tableId/assign-family
 * Assigner une famille à une table
 */
router.post('/events/:eventId/seating-tables/:tableId/assign-family',
  authenticateToken,
  dashboardLimiter,
  celebrate({
    [Segments.PARAMS]: Joi.object().keys({
      eventId: Joi.string().uuid().required(),
      tableId: Joi.string().uuid().required()
    }),
    [Segments.BODY]: Joi.object().keys({
      family_id: Joi.string().uuid().required(),
      seat_number: Joi.number().integer().min(1).optional()
    })
  }),
  async (req, res) => {
    try {
      // TODO: Implémenter l'assignation de famille
      res.status(501).json({
        success: false,
        message: 'Family assignment not yet implemented',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return handleError(res, error, 'assign_family');
    }
  }
);

// ============================================
// MIDDLEWARE DE GESTION D'ERREURS GLOBALES
// ============================================

// Gestionnaire d'erreur pour les erreurs de validation Joi
router.use((error, req, res, next) => {
  if (error.isJoi) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      details: error.details.map(d => d.message),
      timestamp: new Date().toISOString()
    });
  }
  next(error);
});

// Gestionnaire d'erreur générique
router.use((error, req, res, next) => {
  logger.error('Unhandled seating tables error:', error);
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
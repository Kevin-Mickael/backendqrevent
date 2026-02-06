const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { authenticateToken } = require('../middleware/auth');
// 🛡️ Utiliser le rateLimiter dédié pour éviter les conflits avec security.js
const { authLimiter } = require('../middleware/rateLimiter');
const { dashboardLimiter } = require('../middleware/security');
const { userProfileCache, autoInvalidateCache } = require('../middleware/cacheMiddleware');
const { register, login, getProfile, updateProfile, logout } = require('../controllers/authController');

const router = express.Router();

// ============================================
// Validation schemas
// ============================================
const authValidation = {
  register: celebrate({
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().required().max(100).min(2),
      email: Joi.string().email().required(),
      password: Joi.string().min(8).required()
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .messages({
          'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
        })
    })
  }),

  login: celebrate({
    [Segments.BODY]: Joi.object().keys({
      email: Joi.string().email().required(),
      password: Joi.string().required()
    })
  }),

  // Skip Celebrate validation for updateProfile to avoid complex error serialization
  // Validation will be handled in the controller
};

// ============================================
// 🛡️ Routes avec rate limiting strict pour prévenir les attaques par force brute
// ============================================

// 🚨 IMPORTANT: authLimiter est déjà suffisamment restrictif
// On n'applique PAS dashboardLimiter ici pour éviter les conflits
router.post('/register', authLimiter, authValidation.register, register);
router.post('/login', authLimiter, authValidation.login, login);

// Logout nécessite d'être authentifié mais pas de rate limiting strict
// car l'utilisateur est déjà connecté
router.post('/logout', authenticateToken, logout);

// ============================================
// Protected routes - rate limiting pour éviter les appels excessifs
// ============================================
// Utiliser dashboardLimiter pour les routes protégées (utilisateur déjà connecté)
router.get('/profile', 
  dashboardLimiter, 
  authenticateToken, 
  userProfileCache, // Cache pour réduire les appels à la DB
  getProfile
);

router.put('/profile', 
  dashboardLimiter, 
  authenticateToken, 
  autoInvalidateCache(['user', 'events']), // Invalider le cache après mise à jour
  updateProfile
);

module.exports = router;

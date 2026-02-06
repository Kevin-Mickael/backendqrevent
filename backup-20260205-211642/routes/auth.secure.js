const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { authenticateToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const { register, login, getProfile, updateProfile, logout } = require('../controllers/authController');

const router = express.Router();

// Validation schemas
const authValidation = {
  register: celebrate({
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().required().max(100).min(2),
      email: Joi.string().email().required().max(255),
      password: Joi.string().min(8).required() // 🛡️ Augmenté à 8 caractères minimum
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/) // 🛡️ Exige majuscule, minuscule, chiffre
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

  updateProfile: celebrate({
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().min(2).max(100).optional(),
      email: Joi.string().email().max(255).optional(),
      avatar_url: Joi.string().uri().max(500).optional().allow(null),
      preferences: Joi.object().max(20).optional() // 🛡️ Limiter le nombre de clés
    })
  })
};

// 🛡️ Routes avec rate limiting strict
router.post('/register', authLimiter, authValidation.register, register);
router.post('/login', authLimiter, authValidation.login, login);
router.post('/logout', authenticateToken, logout);

// Protected routes
router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, authValidation.updateProfile, updateProfile);

module.exports = router;

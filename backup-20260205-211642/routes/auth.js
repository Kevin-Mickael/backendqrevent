const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { authenticateToken } = require('../middleware/auth');
const { register, login, getProfile, updateProfile, logout } = require('../controllers/authController');

const router = express.Router();

// Validation schemas
const authValidation = {
  register: celebrate({
    [Segments.BODY]: Joi.object().keys({
      name: Joi.string().required().max(100),
      email: Joi.string().email().required(),
      password: Joi.string().min(6).required()
    })
  }),

  login: celebrate({
    [Segments.BODY]: Joi.object().keys({
      email: Joi.string().email().required(),
      password: Joi.string().min(6).required()
    })
  }),

  // Skip Celebrate validation for updateProfile to avoid complex error serialization
  // Validation will be handled in the controller
};

// Routes
router.post('/register', authValidation.register, register);
router.post('/login', authValidation.login, login);
router.post('/logout', authenticateToken, logout);

// Protected routes
router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);

module.exports = router;
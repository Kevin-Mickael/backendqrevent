const jwt = require('jsonwebtoken');
const { users, events } = require('../utils/database');
const config = require('../config/config');

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    // Get token from cookie
    const token = req.cookies.session_token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Session token is required'
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, config.jwtSecret);
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(403).json({
          success: false,
          message: 'Invalid session token'
        });
      }

      if (error.name === 'TokenExpiredError') {
        return res.status(403).json({
          success: false,
          message: 'Session token expired'
        });
      }

      throw error;
    }

    // Find user
    let user;
    try {
      user = await users.findById(decoded.userId);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid session - user not found'
      });
    }

    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Invalid session - user not found or inactive'
      });
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Authorization middleware - check user role
const authorizeRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Role '${req.user.role}' is not authorized.`
      });
    }

    next();
  };
};

// Middleware to validate request body using Joi
const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }
    
    req.validatedBody = value;
    next();
  };
};

// Middleware to check if event belongs to user
const checkEventOwnership = async (req, res, next) => {
  try {
    const { eventId } = req.params;

    // Assuming req.user is set by authenticateToken middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if the event belongs to the authenticated user
    let event;
    try {
      event = await events.findById(eventId);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    if (event.organizer_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are not the owner of this event.'
      });
    }

    next();
  } catch (error) {
    console.error('Event ownership check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  authenticateToken,
  authorizeRole,
  validateRequest,
  checkEventOwnership
};
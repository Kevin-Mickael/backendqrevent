const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// ============================================
// 🔴 CRITIQUE: Rate Limiting Authentification RENFORCÉ
// ============================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // 🛡️ En développement, beaucoup plus permissif
    if (process.env.NODE_ENV === 'development') {
      return 100; // 100 tentatives en dev pour faciliter le développement
    }
    return 10; // 10 tentatives max en production
  },
  keyGenerator: (req) => {
    // Clé composite : IP + Email pour éviter les contournements
    const email = req.body?.email?.toLowerCase()?.trim() || 'no-email';
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    return `auth:${ip}:${email}`;
  },
  skipSuccessfulRequests: true, // Ne pas compter les connexions réussies
  handler: (req, res, next, options) => {
    logger.warn('🚫 Auth rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
      path: req.path,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV
    });
    
    res.status(429).json({
      success: false,
      message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
      retryAfter: Math.ceil(options.windowMs / 1000),
      // Info pour débugger sans exposer de détails sensibles
      debug: process.env.NODE_ENV === 'development' ? {
        windowMs: options.windowMs,
        env: process.env.NODE_ENV
      } : undefined
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiteur général API - plus permissif en développement
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: (req) => {
    // 🛡️ En développement, beaucoup plus permissif
    if (process.env.NODE_ENV === 'development') {
      return 1000; // 1000 requêtes/min en dev
    }
    return 100; // 100 requêtes par minute en prod
  },
  keyGenerator: (req) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userId = req.user?.id ? `:user:${req.user.id}` : '';
    return `api:${ip}${userId}`;
  },
  handler: (req, res, next, options) => {
    logger.warn('🚫 API rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      env: process.env.NODE_ENV
    });
    
    res.status(429).json({
      success: false,
      message: 'Trop de requêtes, veuillez ralentir',
      retryAfter: Math.ceil(options.windowMs / 1000)
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, apiLimiter, generalLimiter: apiLimiter };

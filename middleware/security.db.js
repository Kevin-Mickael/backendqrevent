const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const logger = require('../utils/logger');

// ============================================
// RATE LIMITING GÉNÉRAL
// ============================================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================
// 🔴 CRITIQUE: Rate Limiting Authentification
// ============================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives maximum
  skipSuccessfulRequests: true, // Ne pas compter les connexions réussies
  keyGenerator: (req) => {
    // Clé par email si disponible, sinon IP
    return req.body?.email?.toLowerCase() || req.ip;
  },
  handler: (req, res, next, options) => {
    logger.warn('🚫 Rate limit exceeded for auth endpoint', {
      ip: req.ip,
      email: req.body?.email,
      path: req.path,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json({
      success: false,
      message: 'Too many login attempts. Please try again after 15 minutes.',
      retryAfter: Math.ceil(options.windowMs / 1000)
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================
// 🔴 Rate Limiting QR Code Verification
// ============================================
const qrVerifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 scans par minute max
  message: {
    success: false,
    message: 'Too many QR scans. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================
// 🟡 Rate Limiting Uploads
// ============================================
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 50, // 50 uploads par heure
  message: {
    success: false,
    message: 'Upload limit exceeded. Max 50 files per hour.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================
// 🟡 Rate Limiting API Dashboard
// ============================================
const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 1 requête par seconde en moyenne
  message: {
    success: false,
    message: 'Dashboard API rate limit exceeded.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================
// SECURITY HEADERS
// ============================================
const securityHeaders = helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'DENY' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https://*.supabase.co"],
    },
  },
  noSniff: true,
  dnsPrefetchControl: { allow: false },
});

// ============================================
// PREVENT PARAMETER POLLUTION
// ============================================
const preventParamPollution = (req, res, next) => {
  const queryParams = new URLSearchParams(req.url.split('?')[1]);
  const duplicates = [];

  for (const [key, values] of Object.entries(queryParams)) {
    if (Array.isArray(values) && values.length > 1) {
      duplicates.push(key);
    }
  }

  if (duplicates.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Duplicate parameters detected',
      duplicates
    });
  }

  next();
};

// ============================================
// VALIDATE QR CODE FORMAT
// ============================================
const validateQRCode = (req, res, next) => {
  const { qrCode } = req.params;

  if (qrCode && typeof qrCode === 'string') {
    const qrCodeRegex = /^[a-zA-Z0-9]{10,50}$/;

    if (!qrCodeRegex.test(qrCode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid QR code format'
      });
    }
  }

  next();
};

// ============================================
// SUSPICIOUS ACTIVITY DETECTION
// ============================================
const suspiciousActivityLogger = (req, res, next) => {
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+=/i,
    /\.\.\//,
    /\$\{/,
    /union\s+select/i,
    /exec\s*\(/i
  ];
  
  const bodyStr = JSON.stringify(req.body);
  const urlStr = req.url;
  
  const hasSuspiciousContent = suspiciousPatterns.some(pattern => 
    pattern.test(bodyStr) || pattern.test(urlStr)
  );
  
  if (hasSuspiciousContent) {
    logger.warn('🚨 Suspicious activity detected', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('User-Agent'),
      body: bodyStr.substring(0, 500)
    });
  }
  
  next();
};

module.exports = {
  limiter,
  authLimiter,
  qrVerifyLimiter,
  uploadLimiter,
  dashboardLimiter,
  securityHeaders,
  preventParamPollution,
  validateQRCode,
  suspiciousActivityLogger
};

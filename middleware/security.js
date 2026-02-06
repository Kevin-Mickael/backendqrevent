const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const logger = require('../utils/logger');

// ============================================
// RATE LIMITING INTELLIGENT ADAPTATIF
// ============================================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Limite adaptative selon l'endpoint
    if (req.path.includes('/auth/')) return 10;   // Auth plus strict
    if (req.path.includes('/qr/')) return 60;     // QR codes modéré
    if (req.path.includes('/upload')) return 20;  // Uploads limités
    return 150; // Général plus permissif pour éviter les faux positifs
  },
  keyGenerator: (req) => {
    // Clé intelligente : IP + User ID si authentifié
    const baseKey = req.ip;
    const userKey = req.user?.id ? `:user:${req.user.id}` : '';
    return `${baseKey}${userKey}`;
  },
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip si déjà en cache (évite double comptage)
  skip: (req) => {
    return req.method === 'GET' && req.headers['x-cache-hit'] === 'true';
  }
});

// ============================================
// 🔴 CRITIQUE: Rate Limiting Authentification RENFORCÉ
// ============================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 8, // Augmenté à 8 tentatives (plus réaliste)
  skipSuccessfulRequests: true, // Ne pas compter les connexions réussies
  keyGenerator: (req) => {
    // Clé composite : IP + Email pour éviter les contournements
    const email = req.body?.email?.toLowerCase() || 'no-email';
    return `auth:${req.ip}:${email}`;
  },
  handler: (req, res, next, options) => {
    logger.warn('🚫 Auth rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
      path: req.path,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });
    
    // Délai progressif selon le nombre de tentatives
    const retryAfter = Math.min(300, Math.ceil(options.windowMs / 1000));
    
    res.status(429).json({
      success: false,
      message: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.',
      retryAfter,
      // Info pour débugger sans exposer de détails
      debug: process.env.NODE_ENV === 'development' ? {
        windowMs: options.windowMs,
        maxAttempts: options.max
      } : undefined
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

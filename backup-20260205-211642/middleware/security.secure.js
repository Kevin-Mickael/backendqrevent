const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const logger = require('../utils/logger');

// 🛡️ Rate limiting général pour toutes les routes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🛡️ Rate limiting STRICT pour l'authentification
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives maximum
  skipSuccessfulRequests: true, // Ne pas compter les succès
  message: {
    success: false,
    message: 'Too many login attempts. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn('Rate limit exceeded for auth endpoint', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json(options.message);
  }
});

// 🛡️ Rate limiting pour les uploads (plus permissif mais avec limite de taille)
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 50, // 50 uploads par heure
  message: {
    success: false,
    message: 'Upload limit exceeded. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Enhanced security headers middleware
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
  frameguard: {
    action: 'DENY'
  },
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  },
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

// Prevent parameter pollution
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

// Validate QR code format
const validateQRCode = (req, res, next) => {
  const { qrCode } = req.params;

  if (qrCode && typeof qrCode === 'string') {
    // Basic validation: QR code should be alphanumeric and of certain length
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

// 🛡️ Middleware pour logger les tentatives suspectes
const suspiciousActivityLogger = (req, res, next) => {
  // Détecter les payloads suspects
  const bodyStr = JSON.stringify(req.body);
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+=/i,
    /\.\./, // Path traversal attempt
    /\$\{/ // Template injection
  ];
  
  const hasSuspiciousContent = suspiciousPatterns.some(pattern => 
    pattern.test(bodyStr) || pattern.test(req.url)
  );
  
  if (hasSuspiciousContent) {
    logger.warn('Suspicious activity detected', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('User-Agent'),
      body: bodyStr.substring(0, 200) // Limiter la taille du log
    });
  }
  
  next();
};

module.exports = {
  limiter,
  authLimiter,
  uploadLimiter,
  securityHeaders,
  preventParamPollution,
  validateQRCode,
  suspiciousActivityLogger
};

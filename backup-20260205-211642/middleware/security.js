const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const logger = require('../utils/logger');

// Enhanced rate limiting middleware with different limits for different endpoints
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs for general requests
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Enhanced security headers middleware
const securityHeaders = helmet({
  crossOriginEmbedderPolicy: false, // Allow embedding resources from same origin
  crossOriginOpenerPolicy: { policy: 'same-origin' }, // Restrict how windows open other windows
  crossOriginResourcePolicy: { policy: 'same-site' }, // Control resource sharing between origins
  hidePoweredBy: true, // Hide powered-by header
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true
  }, // HTTP Strict Transport Security
  frameguard: {
    action: 'DENY' // Prevent clickjacking by not allowing iframes
  },
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin' // Control referrer header
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https://*.supabase.co"], // Allow connections to Supabase
    },
  }, // Content Security Policy to prevent XSS
  noSniff: true, // Prevent MIME type sniffing
  dnsPrefetchControl: { allow: false }, // Disable DNS prefetching
});

// Prevent parameter pollution
const preventParamPollution = (req, res, next) => {
  // Check for duplicate parameters in query
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

module.exports = {
  limiter,
  securityHeaders,
  preventParamPollution,
  validateQRCode
};
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const logger = require('../utils/logger');

// ============================================
// 🛡️ SECURITY: Get real client IP, preventing IP spoofing
// ============================================
function getClientIp(req) {
  // En production avec proxy de confiance (ex: Vercel, AWS ELB)
  // configurer TRUST_PROXY=true pour utiliser X-Forwarded-For
  const trustProxy = process.env.TRUST_PROXY === 'true';
  
  if (trustProxy && req.headers['x-forwarded-for']) {
    // Prendre le premier IP (le plus proche du client)
    // Format: client, proxy1, proxy2, ...
    const forwarded = req.headers['x-forwarded-for'].split(',')[0].trim();
    return forwarded;
  }
  
  // Sinon, utiliser la connexion directe (plus sûr, ignore les headers spoofés)
  return req.connection?.remoteAddress || 
         req.socket?.remoteAddress || 
         'unknown';
}

// ============================================
// RATE LIMITING INTELLIGENT ADAPTATIF - RENFORCÉ
// ============================================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // 🛡️ En développement, beaucoup plus permissif
    if (process.env.NODE_ENV === 'development') {
      return 1000; // 1000 requêtes en dev
    }
    
    // Limite adaptative selon l'endpoint et la méthode
    // GET /auth/profile - vérification de session fréquente
    if (req.path.includes('/auth/profile') && req.method === 'GET') {
      return 300; // 300 requêtes par 15min pour les vérifications de session
    }
    // POST /auth/* - login/register (géré par authLimiter séparément)
    if (req.path.includes('/auth/') && req.method === 'POST') {
      return 100; // Laissé grand, authLimiter gère le reste
    }
    // Auth général (autres méthodes)
    if (req.path.includes('/auth/')) return 100;
    if (req.path.includes('/verify-qr')) return 20; // QR verification limitée
    if (req.path.includes('/qr/')) return 30;     // QR codes strict
    if (req.path.includes('/upload')) return 10;  // Uploads très limités
    if (req.path.includes('/api/')) return 100;   // API générale
    return 200; // Général
  },
  keyGenerator: (req) => {
    // 🛡️ SECURITY FIX: Enhanced fingerprint to prevent bypass
    const baseIp = getClientIp(req);
    const userAgent = req.headers['user-agent']?.substring(0, 50) || '';
    const acceptLang = req.headers['accept-language']?.substring(0, 30) || '';
    const userKey = req.user?.id ? `:user:${req.user.id}` : '';
    
    // Create multi-factor fingerprint
    const components = [baseIp, userAgent, acceptLang, userKey].join('|');
    const fingerprint = require('crypto')
      .createHash('sha256')
      .update(components)
      .digest('hex')
      .substring(0, 16);
      
    return `rl:${fingerprint}`;
  },
  handler: (req, res, next, options) => {
    logger.warn('🚫 General rate limit exceeded', {
      ip: getClientIp(req),
      path: req.path,
      userAgent: req.get('User-Agent'),
      env: process.env.NODE_ENV
    });
    res.status(429).json({
      success: false,
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(options.windowMs / 1000)
    });
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
// Note: Ce limiter est exporté mais doit être utilisé avec précaution
// car authLimiter de rateLimiter.js est plus spécifique
// ============================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // 🛡️ En développement, beaucoup plus permissif
    if (process.env.NODE_ENV === 'development') {
      return 100; // 100 tentatives en dev
    }
    return 10; // 10 tentatives en prod
  },
  skipSuccessfulRequests: true, // Ne pas compter les connexions réussies
  keyGenerator: (req) => {
    // 🛡️ SECURITY: Use secure IP function + Email pour éviter les contournements
    const email = req.body?.email?.toLowerCase()?.trim() || 'no-email';
    const clientIp = getClientIp(req);
    return `auth:${clientIp}:${email}`;
  },
  handler: (req, res, next, options) => {
    logger.warn('🚫 Auth rate limit exceeded', {
      ip: getClientIp(req),
      email: req.body?.email,
      path: req.path,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV
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
        maxAttempts: options.max,
        env: process.env.NODE_ENV
      } : undefined
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================
// 🔴 CRITIQUE: Rate Limiting QR Code Verification - STRICT
// ============================================
const qrVerifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: (req) => {
    // 🛡️ En développement, plus permissif
    if (process.env.NODE_ENV === 'development') {
      return 100; // 100 scans/min en dev
    }
    return 10; // 10 scans par minute max en prod
  },
  keyGenerator: (req) => {
    // Clé par IP ou par utilisateur si authentifié
    return req.user?.id 
      ? `qrverify:user:${req.user.id}` 
      : `qrverify:ip:${req.ip || req.connection?.remoteAddress || 'unknown'}`;
  },
  handler: (req, res, next, options) => {
    logger.warn('🚫 QR verification rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path
    });
    res.status(429).json({
      success: false,
      message: 'Too many QR scans. Please slow down and try again later.',
      retryAfter: Math.ceil(options.windowMs / 1000)
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================
// 🔴 Rate Limiting Uploads - STRICT
// ============================================
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: (req) => {
    // 🛡️ En développement, plus permissif
    if (process.env.NODE_ENV === 'development') {
      return 100; // 100 uploads/heure en dev
    }
    return 20; // 20 uploads par heure par utilisateur en prod
  },
  keyGenerator: (req) => {
    // Limite par utilisateur authentifié, sinon par IP
    return req.user?.id 
      ? `upload:user:${req.user.id}` 
      : `upload:ip:${req.ip || 'unknown'}`;
  },
  handler: (req, res, next, options) => {
    logger.warn('🚫 Upload rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path
    });
    res.status(429).json({
      success: false,
      message: 'Upload limit exceeded. Maximum 20 files per hour.',
      retryAfter: Math.ceil(options.windowMs / 1000)
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================
// 🟡 Rate Limiting API Dashboard
// ============================================
const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: (req) => {
    // 🛡️ En développement, plus permissif
    if (process.env.NODE_ENV === 'development') {
      return 500; // 500 requêtes/min en dev
    }
    return 60; // 1 requête par seconde en moyenne en prod
  },
  keyGenerator: (req) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userId = req.user?.id ? `:user:${req.user.id}` : '';
    return `dashboard:${ip}${userId}`;
  },
  handler: (req, res, next, options) => {
    logger.warn('🚫 Dashboard rate limit exceeded', {
      ip: req.ip,
      userId: req.user?.id,
      path: req.path
    });
    res.status(429).json({
      success: false,
      message: 'Dashboard API rate limit exceeded.',
      retryAfter: Math.ceil(options.windowMs / 1000)
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================
// SECURITY HEADERS - RENFORCÉ
// ============================================
const securityHeaders = helmet({
  crossOriginEmbedderPolicy: { policy: 'require-corp' },  // 🛡️ Protection renforcée
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  hidePoweredBy: true,  // 🛡️ Hide X-Powered-By header
  hsts: {
    maxAge: 63072000,  // 🛡️ 2 years for preload eligibility
    includeSubDomains: true,
    preload: true  // 🛡️ HSTS Preload ready
  },
  frameguard: { action: 'DENY' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],  // blob pour les previews
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https://*.supabase.co", "https://*.r2.dev"],
      frameAncestors: ["'none'"],  // 🛡️ Clickjacking protection
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  noSniff: true,
  dnsPrefetchControl: { allow: false },
  ieNoOpen: true,  // 🛡️ X-Download-Options for IE
  originAgentCluster: true,  // 🛡️ Origin-Agent-Cluster
});

// 🛡️ ADDITIONAL SECURITY HEADERS
const additionalSecurityHeaders = (req, res, next) => {
  // Permissions Policy (anciennement Feature-Policy)
  res.setHeader('Permissions-Policy', 
    'camera=(), microphone=(), geolocation=(), interest-cohort=(), accelerometer=(), gyroscope=(), magnetometer=()');
  
  // Cache-Control for sensitive endpoints
  if (req.path.includes('/auth/') || req.path.includes('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  next();
};

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
// VALIDATE QR CODE FORMAT - STRICT
// ============================================
const validateQRCode = (req, res, next) => {
  const { qrCode } = req.params;

  // Vérification stricte : le QR code doit exister et être valide
  if (!qrCode || typeof qrCode !== 'string') {
    logger.warn('🚫 Invalid QR code: missing or not a string', {
      ip: req.ip,
      path: req.path
    });
    return res.status(400).json({
      success: false,
      message: 'QR code is required'
    });
  }

  // Regex strict : uniquement alphanumérique, 10-50 caractères
  const qrCodeRegex = /^[a-zA-Z0-9]{10,50}$/;

  if (!qrCodeRegex.test(qrCode)) {
    logger.warn('🚫 Invalid QR code format detected', {
      ip: req.ip,
      qrCode: qrCode.substring(0, 20), // Log partial for debugging
      path: req.path
    });
    return res.status(400).json({
      success: false,
      message: 'Invalid QR code format'
    });
  }

  next();
};

// ============================================
// SUSPICIOUS ACTIVITY DETECTION
// ============================================
const { sanitizeForLogging } = require('../utils/sanitize');

// 🛡️ ENHANCED: Suspicious activity detection with security events
const suspiciousActivityLogger = (req, res, next) => {
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+=/i,
    /\.\.\//,
    /\.\.\\/,  // Windows backslash variant
    /%2e%2e/i, // URL encoded ..
    /\$\{/,
    /union\s+select/i,
    /exec\s*\(/i,
    /eval\s*\(/i,
    /document\.cookie/i,
    /window\.location/i
  ];
  
  // 🛡️ SECURITY: Sanitize body before stringifying to prevent log injection
  const sanitizedBody = sanitizeForLogging(req.body);
  const bodyStr = JSON.stringify(sanitizedBody);
  const urlStr = req.url;
  
  const hasSuspiciousContent = suspiciousPatterns.some(pattern => 
    pattern.test(bodyStr) || pattern.test(urlStr)
  );
  
  if (hasSuspiciousContent) {
    // 🛡️ SECURITY: Enhanced logging with threat classification
    const securityEvent = {
      event: 'SUSPICIOUS_ACTIVITY',
      severity: 'HIGH',
      ip: getClientIp(req),
      path: req.path,
      userAgent: req.get('User-Agent')?.substring(0, 200),
      // 🛡️ Sanitize body to prevent log injection
      body: bodyStr.substring(0, 500).replace(/[\n\r\x00-\x1F\x7F]/g, ''),
      timestamp: new Date().toISOString(),
      correlationId: require('crypto').randomUUID(),
      sanitized: true
    };
    
    logger.warn('🚨 Suspicious activity detected', securityEvent);
    
    // 🛡️ Store in audit table (async, no performance impact)
    setImmediate(() => {
      require('../utils/database').users.logSecurityEvent?.(securityEvent)
        .catch(err => logger.debug('Security audit log failed:', err.message));
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
  additionalSecurityHeaders,
  preventParamPollution,
  validateQRCode,
  suspiciousActivityLogger,
  getClientIp  // Export pour utilisation dans d'autres modules
};

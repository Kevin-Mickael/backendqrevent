const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('./config/config');
const logger = require('./utils/logger');
const { sanitizeForLog, suspiciousActivityDetector } = require('./utils/securityUtils');
const { dbHealthMonitor } = require('./utils/dbHealth');

// Import routes
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth.supabase');
const gamesPublicRoutes = require('./routes/games-public');
const budgetRoutes = require('./routes/budget');
const messageRoutes = require('./routes/messages');
const galleryRoutes = require('./routes/gallery');
const healthRoutes = require('./routes/health');

// Import middleware
const { limiter, securityHeaders, additionalSecurityHeaders, preventParamPollution } = require('./middleware/security');
// 🛡️ Séparer l'import du authLimiter pour éviter les conflits
const { authLimiter, apiLimiter } = require('./middleware/rateLimiter');
const { handleTokenRefresh } = require('./middleware/refreshToken');
const { 
  userProfileCache, 
  eventsListCache, 
  dashboardStatsCache,
  autoInvalidateCache 
} = require('./middleware/cacheMiddleware');

// Initialize express app
const app = express();

// Import CSP middleware
const cspMiddleware = require('./middleware/csp');

// Apply security middleware first
app.use(cspMiddleware); // Content Security Policy
app.use(securityHeaders); // Security headers (Helmet)
app.use(additionalSecurityHeaders); // Additional security headers
app.use(suspiciousActivityDetector); // Detect suspicious activities
// 🛡️ Rate limiting général avec skip pour les routes auth
// Les routes auth POST ont déjà authLimiter dans auth.js
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // 🛡️ En développement, beaucoup plus permissif
    if (process.env.NODE_ENV === 'development') {
      return 1000;
    }
    return 200;
  },
  skip: (req) => {
    // Skip les routes auth POST - elles ont leur propre rate limiting
    if (req.path.includes('/auth/') && req.method === 'POST') {
      return true;
    }
    return false;
  },
  keyGenerator: (req) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userId = req.user?.id ? `:user:${req.user.id}` : '';
    return `general:${ip}${userId}`;
  },
  handler: (req, res, next, options) => {
    logger.warn('🚫 General rate limit exceeded', {
      ip: req.ip,
      path: req.path,
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
});

app.use(generalLimiter);
app.use(preventParamPollution); // Prevent parameter pollution

// 🛡️ SECURITY: Basic CSRF protection for state-changing requests
const csrfProtection = (req, res, next) => {
  // Skip for GET, HEAD, OPTIONS (safe methods)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  // Skip for webhook endpoints or API endpoints that need external access
  if (req.path.includes('/webhook') || req.path.includes('/public/')) {
    return next();
  }
  
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const allowedOrigins = config.allowedOrigins || [];
  
  // En production, vérifier strictement l'origin
  if (config.nodeEnv === 'production') {
    // Vérifier l'origin header
    if (origin) {
      const isAllowed = allowedOrigins.some(allowed => 
        origin.toLowerCase() === allowed.toLowerCase() ||
        origin.toLowerCase().startsWith(allowed.toLowerCase())
      );
      
      if (!isAllowed) {
        logger.warn('🚫 CSRF protection: Invalid origin', { 
          origin, 
          path: req.path,
          ip: req.ip 
        });
        return res.status(403).json({
          success: false,
          message: 'Invalid origin'
        });
      }
    } else {
      // Si pas d'origin, vérifier le referer
      if (referer) {
        const refererOrigin = new URL(referer).origin;
        const isAllowed = allowedOrigins.some(allowed => 
          refererOrigin.toLowerCase() === allowed.toLowerCase()
        );
        
        if (!isAllowed) {
          logger.warn('🚫 CSRF protection: Invalid referer', { 
            referer, 
            path: req.path,
            ip: req.ip 
          });
          return res.status(403).json({
            success: false,
            message: 'Invalid referer'
          });
        }
      } else {
        // Ni origin ni referer - potentiellement une requête directe (curl, etc.)
        // Logger mais autoriser si authentifié (certains clients légitimes n'envoient pas ces headers)
        if (!req.user && req.path.includes('/api/')) {
          logger.warn('⚠️ CSRF warning: Missing origin and referer', {
            path: req.path,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          });
        }
      }
    }
  }
  
  next();
};

app.use(csrfProtection); // CSRF protection

// Enable CORS with strict configuration
const corsOptions = {
  origin: (origin, callback) => {
    // En production, vérification stricte
    if (config.nodeEnv === 'production') {
      const allowedOrigins = config.allowedOrigins || [];
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn('🚫 CORS blocked request from origin:', { origin, ip: req?.ip });
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // En développement, plus permissif
      callback(null, true);
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  exposedHeaders: ['X-New-Access-Token'] // Exposer le nouveau token si rafraîchi
};
app.use(cors(corsOptions));

// Parse cookies
app.use(cookieParser());

// 🛡️ SECURITY: Body parsing with strict limits
app.use(express.json({ 
  limit: '10mb',
  strict: true,  // Only accept arrays and objects
  verify: (req, res, buf) => {
    // Validate JSON is well-formed
    try {
      JSON.parse(buf);
    } catch (e) {
      res.status(400).json({
        success: false,
        message: 'Invalid JSON format'
      });
      throw new Error('Invalid JSON');
    }
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb',
  parameterLimit: 1000  // Max number of parameters
}));

// 🛡️ SECURITY: Input validation middleware
const validateInputSize = (req, res, next) => {
  // Check for overly large string inputs that could cause ReDoS or memory issues
  const MAX_STRING_LENGTH = 10000;  // 10KB for a single string field
  const MAX_ARRAY_LENGTH = 1000;    // Max items in an array
  const MAX_OBJECT_KEYS = 100;      // Max keys in an object
  
  function checkSize(obj, path = '') {
    if (typeof obj === 'string') {
      if (obj.length > MAX_STRING_LENGTH) {
        throw new Error(`Field ${path} exceeds maximum length of ${MAX_STRING_LENGTH}`);
      }
    } else if (Array.isArray(obj)) {
      if (obj.length > MAX_ARRAY_LENGTH) {
        throw new Error(`Array ${path} exceeds maximum items of ${MAX_ARRAY_LENGTH}`);
      }
      obj.forEach((item, index) => checkSize(item, `${path}[${index}]`));
    } else if (typeof obj === 'object' && obj !== null) {
      const keys = Object.keys(obj);
      if (keys.length > MAX_OBJECT_KEYS) {
        throw new Error(`Object ${path} exceeds maximum keys of ${MAX_OBJECT_KEYS}`);
      }
      keys.forEach(key => checkSize(obj[key], path ? `${path}.${key}` : key));
    }
  }
  
  try {
    if (req.body && Object.keys(req.body).length > 0) {
      checkSize(req.body);
    }
    next();
  } catch (error) {
    logger.warn('Input size validation failed', {
      path: req.path,
      error: error.message
    });
    return res.status(400).json({
      success: false,
      message: 'Input data exceeds allowed limits'
    });
  }
};

app.use(validateInputSize);

// Request logging middleware - only logs userId for authenticated requests
app.use((req, res, next) => {
  // Store the initial request info
  const logInfo = {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: null  // Will be populated after authentication if user is logged in
  };

  // Save the original next function
  const originalNext = next;

  // Override next to log after processing
  next = function (err) {
    // Check if req.user exists after processing the request
    if (req.user && req.user.id) {
      logInfo.userId = req.user.id;
    }

    logger.info(`${req.method} ${req.path}`, logInfo);
    originalNext(err);
  };

  // Continue with the original flow
  originalNext();
});

// Health check endpoint (avant middleware pour éviter overhead)
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Qrevent backend is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 🔄 Token refresh endpoint - AVANT handleTokenRefresh pour éviter le conflit
// Ce endpoint gère lui-même la vérification et rotation des refresh tokens
app.post('/api/auth/refresh-token', require('./middleware/refreshToken').refreshAccessToken);

// Apply token refresh middleware BEFORE protected routes
// This allows automatic token refresh before authentication middleware rejects the request
// ⚠️ SKIP for /api/auth/* routes - they use Supabase Auth, not legacy JWT
app.use((req, res, next) => {
  // Skip handleTokenRefresh for Supabase Auth routes
  if (req.path.startsWith('/api/auth/')) {
    return next();
  }
  handleTokenRefresh(req, res, next);
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/games', gamesPublicRoutes);
app.use('/api/budget', budgetRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/drafts', require('./routes/drafts'));
app.use('/health', healthRoutes);

// 🎮 Redirect /play/* routes to frontend (for QR codes that might point to backend)
app.get('/play/:gameId', (req, res) => {
  const config = require('./config/config');
  const frontendUrl = config.frontendUrl || 'http://localhost:3000';
  const redirectUrl = `${frontendUrl}/play/${req.params.gameId}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
  res.redirect(redirectUrl);
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  // 🛡️ SECURITY: Never expose internal error details in production
  const isDev = config.nodeEnv === 'development';
  
  logger.error('Global error handler triggered', {
    error_message: err.message,
    error_stack: isDev ? err.stack : undefined,
    path: req.path,
    method: req.method,
    body: sanitizeForLog(req.body, 1000) // Sanitize body to avoid logging sensitive data
  });

  // Handle validation errors from celebrate
  if (err.isJoi || err.isCelebrate) {
    logger.warn('Validation error', {
      path: req.path,
      raw_body: sanitizeForLog(req.body, 500)
    });

    // Extract error messages in a more robust way
    let errorMessages = [];
    if (err.details && Array.isArray(err.details)) {
      errorMessages = err.details.map(detail => detail.message);
    } else if (err.details && typeof err.details.map === 'function') {
      errorMessages = [...err.details.values()].map(detail => detail.message);
    } else if (err.joi) {
      errorMessages = [err.joi.message];
    } else {
      errorMessages = ['Validation error occurred'];
    }

    return res.status(400).json({
      success: false,
      message: 'Validation error',
      details: isDev ? errorMessages : undefined  // 🛡️ Only show details in dev
    });
  }

  // 🛡️ SECURITY: Generic error message in production
  // Never expose stack traces, SQL errors, or internal details
  let errorMessage = 'Internal server error';
  let errorCode = 'INTERNAL_ERROR';
  
  if (isDev) {
    errorMessage = err.message;
    errorCode = err.code || 'INTERNAL_ERROR';
  } else {
    // En production, mapper les erreurs communes à des messages génériques
    if (err.code === '23505') {  // PostgreSQL duplicate key
      errorMessage = 'Resource already exists';
      errorCode = 'DUPLICATE_ERROR';
    } else if (err.code === '23503') {  // PostgreSQL foreign key violation
      errorMessage = 'Invalid reference';
      errorCode = 'REFERENCE_ERROR';
    } else if (err.code === 'ECONNREFUSED') {
      errorMessage = 'Service temporarily unavailable';
      errorCode = 'SERVICE_ERROR';
    }
    // Toutes les autres erreurs: message générique
  }

  res.status(err.status || 500).json({
    success: false,
    message: errorMessage,
    ...(isDev && { errorCode, stack: err.stack })  // 🛡️ Détails uniquement en dev
  });
});

// Start server
const startServer = async () => {
  try {
    // Run migrations automatically on startup
    try {
      const { executeMigration } = require('./scripts/run-migration');
      logger.info('Running database migrations on startup...');
      await executeMigration('021_add_guest_count_to_events.sql');
      await executeMigration('027_ensure_max_people_column.sql');
      logger.info('Database migrations completed successfully');
    } catch (migrationError) {
      logger.warn('Migration check completed (may already be applied):', migrationError.message);
      // Continue even if migration fails - it might already be applied
    }

    // Start the server
    server = app.listen(config.port, () => {
      logger.info(`Qrevent backend server running on port ${config.port} in ${config.nodeEnv} mode`);
      console.log(`🚀 Server running on http://localhost:${config.port}`);
      console.log(`📊 Health check: http://localhost:${config.port}/health`);
      
      // Start database health monitoring
      dbHealthMonitor.startMonitoring();
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

let server;

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', {
    message: err.message || err,
    stack: err.stack,
    name: err.name
  });
  // Do not crash the server for unhandled rejections, just log them
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

startServer();

module.exports = app;/* Migration trigger */
/* Trigger restart after migration 028 */

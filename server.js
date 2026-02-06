const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config/config');
const logger = require('./utils/logger');

// Import routes
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const gamesPublicRoutes = require('./routes/games-public');

// Import middleware
const { limiter, authLimiter, securityHeaders, preventParamPollution } = require('./middleware/security');
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
app.use(securityHeaders); // Security headers
app.use(limiter); // Rate limiting
app.use(preventParamPollution); // Prevent parameter pollution

// Enable CORS with specific origins from config
const corsOptions = {
  origin: config.allowedOrigins,
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'Access-Control-Allow-Origin']
};
app.use(cors(corsOptions));

// Parse cookies
app.use(cookieParser());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/games', gamesPublicRoutes);

// Apply token refresh middleware to all routes (to automatically refresh tokens if needed)
app.use(handleTokenRefresh);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Qrevent backend is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Token refresh endpoint
app.post('/api/auth/refresh-token', require('./middleware/refreshToken').refreshAccessToken);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Global error handler triggered', {
    error_message: err.message,
    error_stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body // Log the request body to help debug validation issues
  });

  // Handle validation errors from celebrate
  if (err.isJoi || err.isCelebrate) {
    logger.warn('Validation error', {
      path: req.path,
      raw_body: req.body // Include raw body for debugging
    });

    // Extract error messages in a more robust way
    let errorMessages = [];
    if (err.details && Array.isArray(err.details)) {
      // If details is an array (common in newer versions)
      errorMessages = err.details.map(detail => detail.message);
    } else if (err.details && typeof err.details.map === 'function') {
      // If details is a map-like object
      errorMessages = [...err.details.values()].map(detail => detail.message);
    } else if (err.joi) {
      // If it's a Joi error with a different structure
      errorMessages = [err.joi.message];
    } else {
      errorMessages = ['Validation error occurred'];
    }

    logger.warn('Validation error details', {
      error_messages: errorMessages,
      error_details_structure: typeof err.details,
      has_array_method: !!err.details?.array
    });

    return res.status(400).json({
      success: false,
      message: 'Validation error',
      details: errorMessages
    });
  }

  // Default error response
  res.status(500).json({
    success: false,
    message: config.nodeEnv === 'development' ? err.message : 'Internal server error'
  });
});

// Start server
const startServer = async () => {
  try {
    // Start the server
    server = app.listen(config.port, () => {
      logger.info(`Qrevent backend server running on port ${config.port} in ${config.nodeEnv} mode`);
      console.log(`🚀 Server running on http://localhost:${config.port}`);
      console.log(`📊 Health check: http://localhost:${config.port}/health`);
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

module.exports = app;
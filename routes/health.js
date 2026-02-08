const express = require('express');
const { secretsManager } = require('../utils/secretsManager');
const { dbHealthMonitor } = require('../utils/dbHealth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * 🛡️ Database health check
 * GET /health/database
 */
router.get('/database', async (req, res) => {
  try {
    const healthStatus = dbHealthMonitor.getStatus();
    const statusCode = healthStatus.isHealthy ? 200 : 503;

    res.status(statusCode).json({
      status: healthStatus.isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      database: healthStatus,
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    logger.error('❌ Database health check error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Database health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 🛡️ General health check
 * GET /health
 */
router.get('/', async (req, res) => {
  try {
    const dbHealth = dbHealthMonitor.getStatus();
    const isHealthy = dbHealth.isHealthy;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: {
          status: dbHealth.isHealthy ? 'up' : 'down',
          responseTime: dbHealth.stats.avgResponseTime,
          successRate: dbHealth.stats.successRate
        },
        redis: {
          status: 'optional',
          message: 'Redis is optional and uses memory fallback'
        }
      },
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    logger.error('❌ Health check error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 🛡️ Health check endpoint with security status
 * GET /health/security
 */
router.get('/security', async (req, res) => {
  try {
    const healthStatus = secretsManager.getHealthStatus();
    
    // Remove sensitive details in production
    const isProduction = process.env.NODE_ENV === 'production';
    const response = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: healthStatus.environment,
      secrets: {
        initialized: healthStatus.initialized,
        count: healthStatus.secretsCount,
        healthy: healthStatus.checks.filter(c => c.status === 'healthy').length,
        unhealthy: healthStatus.checks.filter(c => c.status === 'unhealthy').length
      }
    };

    // Include details only in development
    if (!isProduction) {
      response.details = healthStatus.checks.map(check => ({
        secret: check.secret,
        status: check.status,
        error: check.error
      }));
    }

    const hasUnhealthy = healthStatus.checks.some(c => c.status === 'unhealthy');
    const statusCode = hasUnhealthy ? 503 : 200;

    if (hasUnhealthy) {
      logger.warn('🚨 Security health check failed', {
        unhealthy: response.secrets.unhealthy
      });
    }

    res.status(statusCode).json(response);
  } catch (error) {
    logger.error('❌ Security health check error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 🛡️ Generate new secure secret
 * POST /health/generate-secret
 */
router.post('/generate-secret', async (req, res) => {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      message: 'Secret generation not allowed in production'
    });
  }

  try {
    const { length = 64, type = 'hex' } = req.body;

    if (length < 32 || length > 128) {
      return res.status(400).json({
        success: false,
        message: 'Length must be between 32 and 128'
      });
    }

    let secret;
    if (type === 'base64') {
      const { SecretsManager } = require('../utils/secretsManager');
      const buffer = require('crypto').randomBytes(Math.ceil(length * 0.75));
      secret = buffer.toString('base64').substring(0, length);
    } else {
      const { SecretsManager } = require('../utils/secretsManager');
      secret = SecretsManager.generateSecureSecret(length / 2); // hex is 2x longer
    }

    res.json({
      success: true,
      secret: secret,
      length: secret.length,
      type: type,
      message: 'Use this secret in your .env file'
    });

  } catch (error) {
    logger.error('❌ Secret generation error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Secret generation failed'
    });
  }
});

module.exports = router;
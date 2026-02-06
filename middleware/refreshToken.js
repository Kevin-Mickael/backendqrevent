const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { users } = require('../utils/database');
const logger = require('../utils/logger');
const redis = require('ioredis');

// ============================================
// 🔴 CRITIQUE: Stockage Redis pour les refresh tokens
// Permet le scaling horizontal et la persistance
// ============================================
let redisClient = null;
let memoryFallback = new Map(); // Fallback si Redis indisponible

// Initialiser Redis avec gestion d'erreur
const initRedis = async () => {
  if (redisClient) return redisClient;
  
  try {
    const client = new redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 1000,
      enableOfflineQueue: false, // Ne pas queue, on gère le fallback nous-mêmes
      maxRetriesPerRequest: 1,
      lazyConnect: false, // Connecter immédiatement
      connectTimeout: 3000,
    });

    // Attendre la connexion avec timeout
    await Promise.race([
      new Promise((resolve, reject) => {
        client.on('ready', resolve);
        client.on('error', reject);
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis connection timeout')), 3000)
      )
    ]);

    redisClient = client;
    logger.info('Redis connected for refresh tokens');
    return redisClient;
  } catch (error) {
    logger.warn('Redis unavailable, using memory fallback:', error.message);
    redisClient = null;
    return null;
  }
};

const getRedis = async () => {
  if (!redisClient) {
    await initRedis();
  }
  return redisClient;
};

// Clé Redis pour les refresh tokens
const getRedisKey = (token) => `refresh_token:${token}`;

// Generate a refresh token
const generateRefreshToken = async (userId) => {
  // Create a refresh token with longer expiry
  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    config.jwtSecret,
    { expiresIn: '7d' } // 7 days expiry for refresh token
  );

  try {
    const client = getRedis();
    
    if (client) {
      // Stocker dans Redis avec TTL de 7 jours
      await client.setex(getRedisKey(refreshToken), 7 * 24 * 60 * 60, userId.toString());
      logger.info('Refresh token stored in Redis', { userId });
    } else {
      throw new Error('Redis not available');
    }
  } catch (redisError) {
    // Fallback mémoire si Redis indisponible
    memoryFallback.set(refreshToken, {
      userId: userId.toString(),
      expires: Date.now() + (7 * 24 * 60 * 60 * 1000)
    });
    logger.info('Refresh token stored in memory fallback', { userId });
    // Nettoyer les tokens expirés du fallback
    cleanExpiredMemoryTokens();
  }

  return refreshToken;
};

// Nettoyer les tokens expirés du fallback mémoire
const cleanExpiredMemoryTokens = () => {
  const now = Date.now();
  for (const [token, data] of memoryFallback.entries()) {
    if (data.expires <= now) {
      memoryFallback.delete(token);
    }
  }
};

// Verify a refresh token
const verifyRefreshToken = async (token) => {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    
    let userId = null;
    let source = 'none';
    
    try {
      const client = getRedis();
      
      if (client) {
        // Vérifier dans Redis
        userId = await client.get(getRedisKey(token));
        if (userId) source = 'redis';
      }
    } catch (redisError) {
      // Redis error - will fallback to memory
    }
    
    // Si pas trouvé dans Redis ou Redis indisponible, vérifier le fallback
    if (!userId) {
      const data = memoryFallback.get(token);
      if (data && data.expires > Date.now()) {
        userId = data.userId;
        source = 'memory';
      }
    }
    
    if (!userId) {
      logger.debug('Refresh token not found', { userId: decoded.userId, tokenPreview: token.substring(0, 20) + '...' });
      throw new Error('Refresh token not found or expired');
    }
    
    logger.debug('Refresh token verified', { userId, source });
    return { ...decoded, userId: parseInt(userId) };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      // Clean up expired token
      await revokeRefreshToken(token);
      throw new Error('Refresh token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid refresh token');
    } else {
      throw error;
    }
  }
};

// Middleware to handle token refresh
const handleTokenRefresh = async (req, res, next) => {
  const refreshToken = req.cookies.refresh_token;

  if (!refreshToken) {
    // No refresh token, continue with normal flow
    return next();
  }

  try {
    // Verify the refresh token
    const decoded = await verifyRefreshToken(refreshToken);

    // Check if user still exists and is active
    const user = await users.findById(decoded.userId);
    if (!user || !user.is_active) {
      // Invalid user, remove refresh token and continue
      await revokeRefreshToken(refreshToken);
      return next();
    }

    // Generate new access token
    const sessionUtils = require('../utils/session');
    const { token: newAccessToken, cookieOptions } = await sessionUtils.generateSecureSessionCookie(decoded.userId);

    // Send new access token in response header
    res.setHeader('X-New-Access-Token', newAccessToken);

    // Update the access token in the request for downstream middleware
    const newDecodedToken = jwt.verify(newAccessToken, config.jwtSecret);
    req.user = await users.findById(newDecodedToken.userId);

    logger.info('Access token refreshed automatically', {
      userId: decoded.userId,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    next();
  } catch (error) {
    logger.debug('Token refresh skipped (will be handled by endpoint if needed)', {
      error: error.message,
      path: req.path
    });
    
    // 🛑 NE PAS supprimer le refresh token ici !
    // Le endpoint /api/auth/refresh-token en a besoin
    // Continue with normal flow - authentication middleware will handle lack of valid access token
    next();
  }
};

// Endpoint to exchange refresh token for new access token
const refreshAccessToken = async (req, res) => {
  const refreshToken = req.cookies.refresh_token;

  logger.debug('Refresh token endpoint called', { 
    hasCookie: !!refreshToken,
    cookies: Object.keys(req.cookies || {})
  });

  if (!refreshToken) {
    logger.warn('No refresh token in cookies');
    return res.status(401).json({
      success: false,
      message: 'Refresh token required'
    });
  }

  try {
    const decoded = await verifyRefreshToken(refreshToken);

    // Check if user still exists and is active
    const user = await users.findById(decoded.userId);
    if (!user || !user.is_active) {
      await revokeRefreshToken(refreshToken);
      return res.status(401).json({
        success: false,
        message: 'Invalid user'
      });
    }

    // Generate new access token
    const sessionUtils = require('../utils/session');
    const { token: newAccessToken, cookieOptions } = await sessionUtils.generateSecureSessionCookie(decoded.userId);

    // Generate new refresh token to prevent reuse (token rotation)
    const newRefreshToken = await generateRefreshToken(decoded.userId);
    
    // Revoke old refresh token
    await revokeRefreshToken(refreshToken);
    
    // Set new refresh token as cookie avec options sécurisées
    const isProduction = config.nodeEnv === 'production';
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
      domain: isProduction ? process.env.COOKIE_DOMAIN || undefined : undefined
    });

    logger.info('Access token refreshed via endpoint', {
      userId: decoded.userId,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    res.json({
      success: true,
      accessToken: newAccessToken,
      message: 'Token refreshed successfully'
    });
  } catch (error) {
    logger.warn('Failed to refresh access token via endpoint', {
      error: error.message,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    await revokeRefreshToken(refreshToken);
    
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired refresh token'
    });
  }
};

// Middleware to revoke refresh token (logout)
const revokeRefreshToken = async (token) => {
  if (!token) return;
  
  try {
    const client = getRedis();
    
    if (client) {
      await client.del(getRedisKey(token));
    } else {
      memoryFallback.delete(token);
    }
  } catch (error) {
    // Silently fail - le token sera invalide de toute façon au bout de 7 jours
    logger.warn('Failed to revoke refresh token:', { error: error.message });
    memoryFallback.delete(token);
  }
};

// Middleware pour révoquer le token lors du logout
const revokeRefreshTokenMiddleware = async (req, res, next) => {
  const refreshToken = req.cookies.refresh_token;
  
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  
  next();
};

module.exports = {
  generateRefreshToken,
  verifyRefreshToken,
  handleTokenRefresh,
  refreshAccessToken,
  revokeRefreshToken: revokeRefreshTokenMiddleware,
  revokeRefreshTokenDirect: revokeRefreshToken
};

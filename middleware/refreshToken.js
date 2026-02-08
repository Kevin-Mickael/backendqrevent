const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { users } = require('../utils/database');
const logger = require('../utils/logger');

// ============================================
// 🔴 CRITIQUE: Stockage Redis pour les refresh tokens
// Fallback automatique vers mémoire si Redis indisponible
// ============================================
let redisClient = null;
let redisAvailable = false;
let memoryFallback = new Map(); // Fallback si Redis indisponible
let redisInitAttempted = false;

// Initialiser Redis avec gestion d'erreur gracieuse
const initRedis = async () => {
  // Ne pas réessayer si déjà tenté et échoué
  if (redisInitAttempted && !redisAvailable) {
    return null;
  }

  if (redisClient && redisAvailable) {
    return redisClient;
  }

  redisInitAttempted = true;

  // Vérifier si Redis est configuré
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST || 'localhost';

  // Si pas de config Redis explicite et en dev, skip silencieusement
  if (!redisUrl && process.env.NODE_ENV !== 'production') {
    logger.info('Redis not configured, using memory fallback for refresh tokens');
    redisAvailable = false;
    return null;
  }

  try {
    const Redis = require('ioredis');
    const client = new Redis({
      host: redisHost,
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 1000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 2000,
      // Désactiver les retry automatiques en dev
      retryStrategy: (times) => {
        if (times > 1) {
          logger.warn('Redis connection failed, falling back to memory');
          return null; // Stop retrying
        }
        return 1000;
      }
    });

    // Tenter la connexion avec timeout court
    await Promise.race([
      client.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout')), 2000)
      )
    ]);

    // Tester la connexion
    await client.ping();

    redisClient = client;
    redisAvailable = true;
    logger.info('Redis connected for refresh tokens');

    // Gérer la déconnexion
    client.on('error', (err) => {
      logger.warn('Redis error, falling back to memory:', err.message);
      redisAvailable = false;
    });

    client.on('close', () => {
      logger.info('Redis connection closed, using memory fallback');
      redisAvailable = false;
    });

    return redisClient;
  } catch (error) {
    logger.info('Redis unavailable, using memory fallback for refresh tokens:', error.message);
    redisAvailable = false;
    redisClient = null;
    return null;
  }
};

// Obtenir le client Redis (ou null si indisponible)
const getRedis = async () => {
  if (redisAvailable && redisClient) {
    return redisClient;
  }

  // Première tentative d'initialisation
  if (!redisInitAttempted) {
    await initRedis();
  }

  return redisAvailable ? redisClient : null;
};

// Clé Redis pour les refresh tokens
const getRedisKey = (token) => `refresh_token:${token}`;

// Nettoyer les tokens expirés du fallback mémoire
const cleanExpiredMemoryTokens = () => {
  const now = Date.now();
  for (const [token, data] of memoryFallback.entries()) {
    if (data.expires <= now) {
      memoryFallback.delete(token);
    }
  }
};

// Generate a refresh token
const generateRefreshToken = async (userId) => {
  // Create a refresh token with longer expiry
  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    config.jwtSecret,
    { expiresIn: '7d' } // 7 days expiry for refresh token
  );

  try {
    const client = await getRedis();

    if (client) {
      // Stocker dans Redis avec TTL de 7 jours
      await client.setex(getRedisKey(refreshToken), 7 * 24 * 60 * 60, userId.toString());
      logger.debug('Refresh token stored in Redis', { userId });
    } else {
      // Pas de Redis, utiliser le fallback mémoire directement
      throw new Error('Redis not available');
    }
  } catch (redisError) {
    // Fallback mémoire si Redis indisponible
    memoryFallback.set(refreshToken, {
      userId: userId.toString(),
      expires: Date.now() + (7 * 24 * 60 * 60 * 1000)
    });
    logger.debug('Refresh token stored in memory fallback', { userId });
    // Nettoyer les tokens expirés du fallback
    cleanExpiredMemoryTokens();
  }

  return refreshToken;
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
      const client = await getRedis();

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
  const accessToken = req.cookies.session_token;

  // 🔧 CAS 1: Access token valide présent - ne rien faire, laisser authenticateToken gérer
  if (accessToken) {
    try {
      // Vérifier si le token est encore valide
      jwt.verify(accessToken, config.jwtSecret);
      // Token valide, ne pas interférer
      return next();
    } catch (accessError) {
      // Token invalide ou expiré - continuer pour essayer de rafraîchir
      logger.debug('Access token invalid/expired, attempting refresh', {
        error: accessError.name,
        path: req.path
      });
    }
  }

  // 🔧 CAS 2: Pas de refresh token - continuer normalement (authenticateToken va gérer l'erreur)
  if (!refreshToken) {
    return next();
  }

  // 🔧 CAS 3: Rafraîchissement automatique du token
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

    // Set the new access token as cookie
    res.cookie('session_token', newAccessToken, cookieOptions);

    // Send new access token in response header pour le frontend
    res.setHeader('X-New-Access-Token', newAccessToken);

    // Update the access token in the request for downstream middleware
    const newDecodedToken = jwt.verify(newAccessToken, config.jwtSecret);
    req.user = await users.findById(newDecodedToken.userId);

    logger.info('Access token refreshed automatically', {
      userId: decoded.userId,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      path: req.path
    });

    next();
  } catch (error) {
    logger.debug('Token refresh failed', {
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

    // 🛡️ SECURITY FIX: Prevent race condition with simple lock mechanism
    const lockKey = `refresh_lock:${decoded.userId}`;
    
    // Check if refresh is already in progress using memory
    if (memoryFallback.has(lockKey)) {
      return res.status(429).json({
        success: false,
        message: 'Token refresh already in progress, please wait'
      });
    }
    
    // Set lock
    memoryFallback.set(lockKey, { locked: true, expires: Date.now() + 5000 });
    
    try {
      // Revoke old refresh token FIRST (safer order)
      await revokeRefreshToken(refreshToken);
      
      // Generate new refresh token
      const newRefreshToken = await generateRefreshToken(decoded.userId);
      
      // Clear lock
      memoryFallback.delete(lockKey);
      
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
    } catch (innerError) {
      // 🛡️ SECURITY: Always clean up lock on error
      memoryFallback.delete(lockKey);
      throw innerError;
    }
    
  } catch (error) {
    // 🛡️ SECURITY: Always clean up lock on error
    memoryFallback.delete(lockKey);
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
    const client = await getRedis();

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

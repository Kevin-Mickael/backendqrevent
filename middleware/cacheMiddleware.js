const redis = require('ioredis');
const logger = require('../utils/logger');

// Configuration Redis avec fallback en mémoire
let redisClient = null;
const memoryCache = new Map();

try {
  redisClient = new redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    retryDelayOnFailover: 100,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  redisClient.on('error', (err) => {
    logger.warn('Redis connection failed, falling back to memory cache:', err.message);
    redisClient = null;
  });
} catch (error) {
  logger.warn('Redis initialization failed, using memory cache:', error.message);
  redisClient = null;
}

// ============================================
// CACHE INTELLIGENT MULTI-NIVEAU
// ============================================

/**
 * Cache intelligent avec stratégie multi-niveau:
 * 1. Redis (distribué) si disponible
 * 2. Memory (local) en fallback
 * 3. TTL adaptatif selon le type de données
 */
class IntelligentCache {
  static TTL = {
    USER_PROFILE: 300,      // 5 minutes - données utilisateur
    EVENTS_LIST: 180,       // 3 minutes - liste événements
    EVENT_DETAILS: 600,     // 10 minutes - détails événement
    QR_VALIDATION: 30,      // 30 secondes - validation QR
    DASHBOARD_STATS: 120,   // 2 minutes - statistiques
    FAMILIES: 300,          // 5 minutes - familles
    INVITATIONS: 180,       // 3 minutes - invitations
    STATIC_DATA: 3600,      // 1 heure - données statiques
  };

  static async get(key) {
    try {
      // Essayer Redis d'abord
      if (redisClient) {
        const value = await redisClient.get(key);
        if (value) {
          return JSON.parse(value);
        }
      }
      
      // Fallback mémoire
      const memValue = memoryCache.get(key);
      if (memValue && memValue.expires > Date.now()) {
        return memValue.data;
      }
      
      return null;
    } catch (error) {
      logger.warn('Cache get error:', error.message);
      return null;
    }
  }

  static async set(key, data, ttlSeconds = 300) {
    try {
      const value = JSON.stringify(data);
      
      // Sauver dans Redis si disponible
      if (redisClient) {
        await redisClient.setex(key, ttlSeconds, value);
      }
      
      // Sauver en mémoire (avec expiration)
      memoryCache.set(key, {
        data: data,
        expires: Date.now() + (ttlSeconds * 1000)
      });
      
      // Nettoyer les clés expirées en mémoire
      this.cleanExpiredMemoryCache();
      
    } catch (error) {
      logger.warn('Cache set error:', error.message);
    }
  }

  static async del(key) {
    try {
      if (redisClient) {
        await redisClient.del(key);
      }
      memoryCache.delete(key);
    } catch (error) {
      logger.warn('Cache delete error:', error.message);
    }
  }

  static async invalidatePattern(pattern) {
    try {
      if (redisClient) {
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      }
      
      // Invalider en mémoire
      for (const key of memoryCache.keys()) {
        if (key.match(pattern.replace('*', '.*'))) {
          memoryCache.delete(key);
        }
      }
    } catch (error) {
      logger.warn('Cache pattern invalidation error:', error.message);
    }
  }

  static cleanExpiredMemoryCache() {
    const now = Date.now();
    for (const [key, value] of memoryCache.entries()) {
      if (value.expires <= now) {
        memoryCache.delete(key);
      }
    }
  }
}

// ============================================
// MIDDLEWARE DE CACHE POUR ROUTES SPÉCIFIQUES
// ============================================

/**
 * Cache pour endpoints de lecture fréquente
 */
const cacheMiddleware = (ttl = 300, keyGenerator = null) => {
  return async (req, res, next) => {
    // Skip cache pour POST, PUT, DELETE
    if (req.method !== 'GET') {
      return next();
    }

    try {
      const cacheKey = keyGenerator 
        ? keyGenerator(req) 
        : `api:${req.originalUrl}:${req.user?.id || 'anonymous'}`;

      const cachedData = await IntelligentCache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }

      // Intercepter la réponse pour la mettre en cache
      const originalSend = res.json;
      res.json = function(data) {
        // Cache seulement les réponses success
        if (data.success !== false) {
          IntelligentCache.set(cacheKey, data, ttl).catch(err => {
            logger.warn('Failed to cache response:', err.message);
          });
        }
        return originalSend.call(this, data);
      };

      next();
    } catch (error) {
      logger.warn('Cache middleware error:', error.message);
      next();
    }
  };
};

// ============================================
// CACHES SPÉCIALISÉS POUR DIFFÉRENTS ENDPOINTS
// ============================================

const userProfileCache = cacheMiddleware(
  IntelligentCache.TTL.USER_PROFILE,
  (req) => `user:profile:${req.user?.id}`
);

const eventsListCache = cacheMiddleware(
  IntelligentCache.TTL.EVENTS_LIST,
  (req) => `user:events:${req.user?.id}`
);

const eventDetailsCache = cacheMiddleware(
  IntelligentCache.TTL.EVENT_DETAILS,
  (req) => `event:${req.params.id}:${req.user?.id}`
);

const dashboardStatsCache = cacheMiddleware(
  IntelligentCache.TTL.DASHBOARD_STATS,
  (req) => `dashboard:stats:${req.user?.id}:${req.params.eventId || 'all'}`
);

const familiesCache = cacheMiddleware(
  IntelligentCache.TTL.FAMILIES,
  (req) => `families:${req.user?.id}:${req.query.eventId || 'all'}`
);

const invitationsCache = cacheMiddleware(
  IntelligentCache.TTL.INVITATIONS,
  (req) => `invitations:${req.user?.id}:${req.query.eventId || 'all'}`
);

// ============================================
// INVALIDATION INTELLIGENTE DU CACHE
// ============================================

/**
 * Invalide automatiquement les caches reliés
 */
const invalidateRelatedCaches = async (userId, eventId = null, type = 'general') => {
  try {
    const patterns = [];
    
    switch (type) {
      case 'user_update':
        patterns.push(`user:profile:${userId}`);
        break;
        
      case 'event_update':
        patterns.push(`user:events:${userId}`);
        if (eventId) {
          patterns.push(`event:${eventId}:*`);
          patterns.push(`dashboard:stats:${userId}:${eventId}`);
        }
        break;
        
      case 'family_update':
        patterns.push(`families:${userId}:*`);
        patterns.push(`invitations:${userId}:*`);
        if (eventId) {
          patterns.push(`dashboard:stats:${userId}:${eventId}`);
        }
        break;
        
      case 'invitation_update':
        patterns.push(`invitations:${userId}:*`);
        if (eventId) {
          patterns.push(`dashboard:stats:${userId}:${eventId}`);
        }
        break;
        
      default:
        patterns.push(`user:${userId}:*`);
    }

    for (const pattern of patterns) {
      await IntelligentCache.invalidatePattern(pattern);
    }
    
    logger.info('Cache invalidated', { userId, eventId, type, patterns });
  } catch (error) {
    logger.warn('Cache invalidation error:', error.message);
  }
};

// Middleware d'invalidation automatique pour les mutations
const autoInvalidateCache = (type) => {
  return async (req, res, next) => {
    const originalSend = res.json;
    res.json = function(data) {
      // Si succès, invalider les caches
      if (data.success !== false && req.user?.id) {
        invalidateRelatedCaches(
          req.user.id, 
          req.params.eventId || req.body.eventId,
          type
        ).catch(err => {
          logger.warn('Auto cache invalidation failed:', err.message);
        });
      }
      return originalSend.call(this, data);
    };
    next();
  };
};

module.exports = {
  IntelligentCache,
  cacheMiddleware,
  userProfileCache,
  eventsListCache,
  eventDetailsCache,
  dashboardStatsCache,
  familiesCache,
  invitationsCache,
  invalidateRelatedCaches,
  autoInvalidateCache
};
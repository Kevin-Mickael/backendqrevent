/**
 * Cache Layer - Redis Implementation
 * 
 * Fournit une couche de cache pour réduire la charge sur la base de données.
 * 
 * Usage:
 *   const cache = require('./utils/cache');
 *   const data = await cache.getOrSet('key', () => fetchData(), 300);
 */

const Redis = require('ioredis');
const logger = require('./logger');

// Configuration Redis
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Client Redis
let redis = null;
let isConnected = false;

/**
 * Initialise la connexion Redis
 */
const initRedis = () => {
  if (redis) return redis;

  try {
    redis = new Redis(REDIS_URL, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true // Ne se connecte que lors de la première commande
    });

    redis.on('connect', () => {
      isConnected = true;
      logger.info('✅ Redis connected');
    });

    redis.on('error', (err) => {
      isConnected = false;
      logger.error('❌ Redis error:', err.message);
    });

    redis.on('close', () => {
      isConnected = false;
      logger.warn('⚠️  Redis connection closed');
    });

    return redis;
  } catch (error) {
    logger.error('Failed to initialize Redis:', error.message);
    return null;
  }
};

// Initialiser au chargement
initRedis();

/**
 * Génère une clé de cache avec préfixe
 */
const generateKey = (key, prefix = 'qrevent') => {
  return `${prefix}:${key}`;
};

/**
 * Récupère une valeur du cache
 */
const get = async (key, prefix = 'qrevent') => {
  if (!redis || !isConnected) return null;

  try {
    const fullKey = generateKey(key, prefix);
    const value = await redis.get(fullKey);
    
    if (value) {
      logger.debug(`Cache HIT: ${fullKey}`);
      return JSON.parse(value);
    }
    
    logger.debug(`Cache MISS: ${fullKey}`);
    return null;
  } catch (error) {
    logger.error(`Cache GET error for ${key}:`, error.message);
    return null;
  }
};

/**
 * Stocke une valeur dans le cache
 */
const set = async (key, value, ttlSeconds = 300, prefix = 'qrevent') => {
  if (!redis || !isConnected) return false;

  try {
    const fullKey = generateKey(key, prefix);
    const serialized = JSON.stringify(value);
    
    await redis.setex(fullKey, ttlSeconds, serialized);
    logger.debug(`Cache SET: ${fullKey} (TTL: ${ttlSeconds}s)`);
    return true;
  } catch (error) {
    logger.error(`Cache SET error for ${key}:`, error.message);
    return false;
  }
};

/**
 * Supprime une valeur du cache
 */
const del = async (key, prefix = 'qrevent') => {
  if (!redis || !isConnected) return false;

  try {
    const fullKey = generateKey(key, prefix);
    await redis.del(fullKey);
    logger.debug(`Cache DEL: ${fullKey}`);
    return true;
  } catch (error) {
    logger.error(`Cache DEL error for ${key}:`, error.message);
    return false;
  }
};

/**
 * Supprime les clés correspondant à un pattern
 */
const delPattern = async (pattern, prefix = 'qrevent') => {
  if (!redis || !isConnected) return 0;

  try {
    const fullPattern = generateKey(pattern, prefix);
    const keys = await redis.keys(fullPattern);
    
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.debug(`Cache DEL pattern: ${fullPattern} (${keys.length} keys)`);
      return keys.length;
    }
    
    return 0;
  } catch (error) {
    logger.error(`Cache DEL pattern error for ${pattern}:`, error.message);
    return 0;
  }
};

/**
 * Récupère ou calcule une valeur (pattern Get-Or-Set)
 */
const getOrSet = async (key, fetchFn, ttlSeconds = 300, prefix = 'qrevent') => {
  // Essayer de récupérer du cache
  const cached = await get(key, prefix);
  if (cached !== null) {
    return cached;
  }

  // Calculer la valeur
  try {
    const value = await fetchFn();
    
    // Stocker dans le cache (même si null/undefined pour éviter les thundering herd)
    await set(key, value, ttlSeconds, prefix);
    
    return value;
  } catch (error) {
    logger.error(`Cache fetch function error for ${key}:`, error.message);
    throw error;
  }
};

/**
 * Invalide le cache lié à un événement
 */
const invalidateEventCache = async (eventId) => {
  const patterns = [
    `events:${eventId}:*`,
    `guests:${eventId}:*`,
    `dashboard:${eventId}:*`
  ];

  let totalDeleted = 0;
  for (const pattern of patterns) {
    totalDeleted += await delPattern(pattern);
  }

  logger.info(`Invalidated ${totalDeleted} cache entries for event ${eventId}`);
  return totalDeleted;
};

/**
 * Récupère les statistiques du cache
 */
const getStats = async () => {
  if (!redis || !isConnected) {
    return { connected: false };
  }

  try {
    const info = await redis.info('stats');
    const hits = info.match(/keyspace_hits:(\d+)/)?.[1] || 0;
    const misses = info.match(/keyspace_misses:(\d+)/)?.[1] || 0;
    const hitRate = hits + misses > 0 ? (hits / (hits + misses) * 100).toFixed(2) : 0;

    return {
      connected: true,
      hits: parseInt(hits),
      misses: parseInt(misses),
      hitRate: `${hitRate}%`,
      keys: await redis.dbsize()
    };
  } catch (error) {
    logger.error('Cache stats error:', error.message);
    return { connected: false, error: error.message };
  }
};

/**
 * Vide complètement le cache (⚠️ Danger!)
 */
const flushAll = async () => {
  if (!redis || !isConnected) return false;

  try {
    await redis.flushall();
    logger.warn('🚨 Cache flushed completely!');
    return true;
  } catch (error) {
    logger.error('Cache flush error:', error.message);
    return false;
  }
};

/**
 * Ferme proprement la connexion Redis
 */
const close = async () => {
  if (redis) {
    await redis.quit();
    logger.info('Redis connection closed');
  }
};

module.exports = {
  initRedis,
  get,
  set,
  del,
  delPattern,
  getOrSet,
  invalidateEventCache,
  getStats,
  flushAll,
  close,
  isConnected: () => isConnected
};

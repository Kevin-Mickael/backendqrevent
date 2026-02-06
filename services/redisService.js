/**
 * Service Redis et Queue pour le traitement d'images en arrière-plan
 * Fournit une abstraction pour Redis et les queues de traitement
 */

const redis = require('ioredis');
const logger = require('../utils/logger');

// ============================================
// CONFIGURATION REDIS
// ============================================

let redisClient = null;
let isConnected = false;

const initRedis = () => {
  if (redisClient) return redisClient;
  
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

    redisClient.on('connect', () => {
      isConnected = true;
      logger.info('Redis connected successfully');
    });

    redisClient.on('error', (err) => {
      isConnected = false;
      logger.warn('Redis connection error:', err.message);
    });

    return redisClient;
  } catch (error) {
    logger.warn('Redis initialization failed:', error.message);
    return null;
  }
};

// ============================================
// SERVICE REDIS
// ============================================

const redisService = {
  getClient: () => {
    if (!redisClient) {
      redisClient = initRedis();
    }
    return redisClient;
  },
  
  isConnected: () => {
    if (!redisClient) {
      redisClient = initRedis();
    }
    return isConnected && redisClient?.status === 'ready';
  },
  
  disconnect: async () => {
    if (redisClient) {
      await redisClient.quit();
      isConnected = false;
      redisClient = null;
    }
  }
};

// ============================================
// QUEUE DE TRAITEMENT D'IMAGES (STUB)
// ============================================

/**
 * Stub pour la queue de traitement d'images
 * En production, remplacer par Bull ou Bee-Queue avec Redis
 */
const imageProcessingQueue = {
  add: async (jobName, data, options = {}) => {
    logger.info('Image processing job queued', { 
      jobName, 
      userId: data.userId,
      processType: data.processType 
    });
    
    // Simuler l'ajout d'un job - en production, utiliser une vraie queue
    // comme Bull avec Redis
    
    // Pour l'instant, traiter immédiatement de manière asynchrone
    setImmediate(async () => {
      try {
        // Ici on pourrait appeler le service d'optimisation d'images
        logger.info('Processing image job (async)', { jobName, userId: data.userId });
      } catch (error) {
        logger.error('Image processing job failed', { 
          error: error.message, 
          jobName, 
          userId: data.userId 
        });
      }
    });
    
    // Retourner un ID de job unique
    return `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  },
  
  getJob: async (jobId) => {
    // Stub - en production, récupérer depuis Redis/Bull
    return { id: jobId, status: 'completed', progress: 100 };
  }
};

// Initialiser Redis au démarrage
initRedis();

module.exports = {
  redisService,
  imageProcessingQueue,
  initRedis
};

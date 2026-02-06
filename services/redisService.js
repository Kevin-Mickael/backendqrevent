/**
 * Service Redis et Queue pour le traitement d'images en arrière-plan
 * Utilise Bull pour la gestion des jobs avec Redis
 */

const Redis = require('ioredis');
const Queue = require('bull');
const logger = require('../utils/logger');

// ============================================
// CONFIGURATION REDIS
// ============================================

let redisClient = null;
let isConnected = false;

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => {
    if (times > 3) {
      logger.warn('Redis: Max retry attempts reached, giving up');
      return null; // Stop retrying
    }
    return Math.min(times * 100, 3000);
  },
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableOfflineQueue: false,
};

const initRedis = () => {
  if (redisClient) return redisClient;

  try {
    redisClient = new Redis(redisConfig);

    redisClient.on('connect', () => {
      isConnected = true;
      logger.info('Redis: Connected successfully');
    });

    redisClient.on('ready', () => {
      isConnected = true;
      logger.info('Redis: Ready to accept commands');
    });

    redisClient.on('error', (err) => {
      isConnected = false;
      logger.warn('Redis: Connection error', { error: err.message });
    });

    redisClient.on('close', () => {
      isConnected = false;
      logger.info('Redis: Connection closed');
    });

    // Try to connect
    redisClient.connect().catch((err) => {
      logger.warn('Redis: Initial connection failed', { error: err.message });
    });

    return redisClient;
  } catch (error) {
    logger.warn('Redis: Initialization failed', { error: error.message });
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
    return isConnected && redisClient?.status === 'ready';
  },

  disconnect: async () => {
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch (error) {
        logger.warn('Redis: Disconnect error', { error: error.message });
      }
      isConnected = false;
      redisClient = null;
    }
  },

  // Helper methods for caching
  async get(key) {
    if (!this.isConnected()) return null;
    try {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.warn('Redis get error', { key, error: error.message });
      return null;
    }
  },

  async set(key, value, ttlSeconds = 300) {
    if (!this.isConnected()) return false;
    try {
      await redisClient.setex(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.warn('Redis set error', { key, error: error.message });
      return false;
    }
  },

  async del(key) {
    if (!this.isConnected()) return false;
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      logger.warn('Redis del error', { key, error: error.message });
      return false;
    }
  }
};

// ============================================
// QUEUE DE TRAITEMENT D'IMAGES (BULL)
// ============================================

let imageQueue = null;

/**
 * Initialize Bull queue for image processing
 * Falls back to synchronous processing if Redis is unavailable
 */
const initImageQueue = () => {
  if (imageQueue) return imageQueue;

  try {
    imageQueue = new Queue('image-processing', {
      redis: redisConfig,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    });

    imageQueue.on('error', (error) => {
      logger.error('Bull Queue: Error', { error: error.message });
    });

    imageQueue.on('failed', (job, err) => {
      logger.error('Bull Queue: Job failed', {
        jobId: job.id,
        jobName: job.name,
        error: err.message
      });
    });

    imageQueue.on('completed', (job, result) => {
      logger.info('Bull Queue: Job completed', {
        jobId: job.id,
        jobName: job.name,
        resultType: typeof result
      });
    });

    logger.info('Bull Queue: Image processing queue initialized');
    return imageQueue;
  } catch (error) {
    logger.warn('Bull Queue: Initialization failed, using fallback', { error: error.message });
    return null;
  }
};

/**
 * Image processing queue with fallback support
 */
const imageProcessingQueue = {
  /**
   * Add a job to the queue
   * @param {string} jobName - Job name/type
   * @param {Object} data - Job data
   * @param {Object} options - Bull job options
   * @returns {Promise<string>} - Job ID
   */
  async add(jobName, data, options = {}) {
    // Initialize queue if needed
    if (!imageQueue) {
      initImageQueue();
    }

    // Try Bull queue first
    if (imageQueue) {
      try {
        const job = await imageQueue.add(jobName, {
          ...data,
          addedAt: new Date().toISOString()
        }, options);

        logger.info('Image job queued', {
          jobId: job.id,
          jobName,
          userId: data.userId
        });

        return job.id.toString();
      } catch (error) {
        logger.warn('Bull Queue: Failed to add job, using fallback', { error: error.message });
      }
    }

    // Fallback: Process immediately with setImmediate (non-blocking)
    logger.info('Image processing fallback (async immediate)', {
      jobName,
      userId: data.userId
    });

    const jobId = `fallback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Return immediately, process in background
    setImmediate(async () => {
      try {
        // Import dynamically to avoid circular dependency
        const imageService = require('./imageService');

        if (data.processType === 'avatar') {
          await imageService.processAvatarWithFallback(data);
        } else if (data.processType === 'banner') {
          await imageService.processBannerWithFallback(data);
        } else if (data.processType === 'cover') {
          await imageService.processCoverWithFallback(data);
        }

        logger.info('Image fallback processing completed', { jobId, jobName });
      } catch (error) {
        logger.error('Image fallback processing failed', {
          jobId,
          jobName,
          error: error.message
        });
      }
    });

    return jobId;
  },

  /**
   * Get job status
   */
  async getJob(jobId) {
    if (!imageQueue) {
      return { id: jobId, status: 'unknown', progress: 0 };
    }

    try {
      const job = await imageQueue.getJob(jobId);
      if (!job) {
        return { id: jobId, status: 'not_found', progress: 0 };
      }

      const state = await job.getState();
      return {
        id: jobId,
        status: state,
        progress: job.progress(),
        data: job.data
      };
    } catch (error) {
      logger.warn('Failed to get job status', { jobId, error: error.message });
      return { id: jobId, status: 'error', progress: 0 };
    }
  },

  /**
   * Get queue stats
   */
  async getStats() {
    if (!imageQueue) {
      return { active: 0, waiting: 0, completed: 0, failed: 0, available: false };
    }

    try {
      const [active, waiting, completed, failed] = await Promise.all([
        imageQueue.getActiveCount(),
        imageQueue.getWaitingCount(),
        imageQueue.getCompletedCount(),
        imageQueue.getFailedCount()
      ]);

      return { active, waiting, completed, failed, available: true };
    } catch (error) {
      logger.warn('Failed to get queue stats', { error: error.message });
      return { active: 0, waiting: 0, completed: 0, failed: 0, available: false };
    }
  },

  /**
   * Process jobs (worker function)
   * Call this to start processing jobs on this instance
   */
  processJobs(handler) {
    if (!imageQueue) {
      logger.warn('Queue not available, cannot start job processor');
      return;
    }

    imageQueue.process(async (job) => {
      logger.info('Processing image job', { jobId: job.id, type: job.data.processType });
      return handler(job.data);
    });

    logger.info('Image job processor started');
  }
};

// Initialize Redis on module load
initRedis();

module.exports = {
  redisService,
  imageProcessingQueue,
  initRedis,
  initImageQueue
};

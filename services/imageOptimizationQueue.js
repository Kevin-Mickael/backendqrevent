const Bull = require('bull');
const imageService = require('./imageService');
const storageService = require('./storageService');
const logger = require('../utils/logger');
const redisConfig = require('../config/redis');

// Create a Bull queue for image optimization jobs
// Use Redis if available, otherwise use in-memory store (for development)
const bullRedisConfig = redisConfig.redisUrl ?
  { redis: redisConfig.redisUrl } :
  { redis: redisConfig.redis };

// Flag to track if Redis is available
let isRedisAvailable = false; // Start with false, will be set to true only on successful connection
let imageOptimizationQueue;

// Define the direct processing function at module scope so it's available everywhere
const processImageJobDirectly = async (data) => {
  const { buffer, originalName, mimetype, folder, imageUsage, userId, eventId } = data;

  logger.info('Processing image optimization directly (no Redis)', {
    originalName: originalName,
    folder: folder,
    imageUsage: imageUsage,
    userId: userId,
    eventId: eventId,
    timestamp: new Date().toISOString()
  });

  // Optimize the image based on its intended usage
  const { buffer: optimizedBuffer, mimetype: optimizedMimetype, extension } =
    await imageService.optimizeImageByUsage(buffer, imageUsage);

  // Generate a unique filename
  const fileName = storageService.generateUniqueFileName(originalName);

  // Upload the optimized image to R2
  const publicUrl = await storageService.uploadFile({
    buffer: optimizedBuffer,
    originalname: `${fileName}${extension}`,
    mimetype: optimizedMimetype
  }, folder);

  // If this is an event-related image, update the event record
  if (eventId) {
    const { events } = require('../utils/database');
    // Determine if it's a banner or cover based on folder
    const isBanner = folder.includes('banners');
    const updateField = isBanner ? { banner_image: publicUrl } : { cover_image: publicUrl };

    await events.update(eventId, updateField);

    logger.info(`Event ${eventId} ${isBanner ? 'banner' : 'cover'} image updated (direct processing)`, {
      publicUrl: publicUrl,
      timestamp: new Date().toISOString()
    });
  }

  logger.info('Image optimization and upload completed (direct processing)', {
    originalName: originalName,
    publicUrl: publicUrl,
    timestamp: new Date().toISOString()
  });

  return { success: true, publicUrl, eventId };
};

// Attempt to initialize the queue with connection error handling
try {
  imageOptimizationQueue = new Bull('image optimization', bullRedisConfig);

  // Handle Redis connection errors gracefully
  imageOptimizationQueue.on('error', (error) => {
    // Only log error if we haven't already marked Redis as unavailable (to prevent spam)
    if (isRedisAvailable) {
      logger.error('Redis/Bull queue error (disabling Redis queue system):', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });

      // Mark Redis as unavailable
      isRedisAvailable = false;

      // Log a more descriptive message about fallback
      logger.warn('Redis connection failed, switched to direct processing mode without queueing');

      // We do NOT call close() here to avoid unhandled rejections from pending internal promises
      // caused by the abrupt connection failure. We just stop using the queue.
    }
  });

  // Listen for successful connections
  imageOptimizationQueue.on('ready', () => {
    logger.info('Redis/Bull queue connected successfully', {
      timestamp: new Date().toISOString()
    });
    isRedisAvailable = true;
  });

  // Listen for when the queue is drained
  imageOptimizationQueue.on('drained', () => {
    logger.info('Image optimization queue drained', {
      timestamp: new Date().toISOString()
    });
  });

  // Listen for when the queue is paused
  imageOptimizationQueue.on('paused', () => {
    logger.info('Image optimization queue paused', {
      timestamp: new Date().toISOString()
    });
  });

  // Listen for when the queue is resumed
  imageOptimizationQueue.on('resumed', () => {
    logger.info('Image optimization queue resumed', {
      timestamp: new Date().toISOString()
    });
  });

  // Listen for when a job is waiting
  imageOptimizationQueue.on('waiting', (jobId) => {
    logger.debug(`Image optimization job ${jobId} is waiting`, {
      timestamp: new Date().toISOString()
    });
  });

  // Listen for when a job is active
  imageOptimizationQueue.on('active', (job) => {
    logger.debug(`Image optimization job ${job.id} is active`, {
      timestamp: new Date().toISOString()
    });
  });

  // Listen for when a job is completed
  imageOptimizationQueue.on('completed', (job, result) => {
    logger.info(`Image optimization job ${job.id} completed`, {
      result: result,
      timestamp: new Date().toISOString()
    });
  });

  // Listen for when a job has failed
  imageOptimizationQueue.on('failed', (job, err) => {
    logger.error(`Image optimization job ${job.id} failed`, {
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
  });

  // Process jobs in the queue
  imageOptimizationQueue.process('optimizeImage', async (job) => {
    const { buffer, originalName, mimetype, folder, imageUsage, userId, eventId } = job.data;

    try {
      logger.info('Starting image optimization job', {
        jobId: job.id,
        userId: userId,
        eventId: eventId,
        originalName: originalName,
        folder: folder,
        imageUsage: imageUsage
      });

      // Reuse the direct processing logic since it's the same core logic
      const result = await processImageJobDirectly({
        buffer: Buffer.from(buffer), // Ensure buffer is treated correctly
        originalName,
        mimetype,
        folder,
        imageUsage,
        userId,
        eventId
      });

      return result;
    } catch (error) {
      logger.error('Image optimization job failed', {
        jobId: job.id,
        userId: userId,
        eventId: eventId,
        error: error.message,
        stack: error.stack
      });

      throw error;
    }
  });

} catch (error) {
  logger.error('Critical error initializing Redis queue:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });

  logger.warn('Failed to initialize Redis queue, falling back to direct processing', {
    error: error.message
  });

  // Mark Redis as unavailable
  isRedisAvailable = false;

  // Create a mock queue object that processes jobs directly
  imageOptimizationQueue = {
    add: async (jobName, data, options) => {
      // Simulate a job with a random ID
      const jobId = Math.random().toString(36).substring(2, 15);

      logger.info('Processing image optimization job directly (no Redis)', {
        jobId: jobId,
        originalName: data.originalName,
        timestamp: new Date().toISOString()
      });

      // Process the job directly
      try {
        const result = await processImageJobDirectly(data);
        return { id: jobId, result };
      } catch (error) {
        logger.error('Direct image optimization failed', {
          jobId: jobId,
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
        throw error;
      }
    },
    process: () => { }, // No-op for mock
    on: () => { },     // No-op for mock
    close: async () => { } // No-op for mock
  };
}

// Function to add an image optimization job to the queue
const addImageOptimizationJob = async ({ buffer, originalName, mimetype, folder = 'uploads', imageUsage = 'general', userId, eventId }) => {
  try {
    // If Redis is not available, process directly immediately
    if (!isRedisAvailable) {
      // Generate a fake job ID for consistency
      const jobId = Math.random().toString(36).substring(2, 15);

      logger.info('Initiating direct image optimization (Redis unavailable)', {
        jobId: jobId,
        userId: userId,
        originalName: originalName
      });

      // Process directly and return the result
      const result = await processImageJobDirectly({
        buffer,
        originalName,
        mimetype,
        folder,
        imageUsage,
        userId,
        eventId
      });

      // Return the URL directly instead of job ID
      return result.publicUrl || jobId;
    }

    // For Redis-backed queue, add to the actual queue
    const job = await imageOptimizationQueue.add('optimizeImage', {
      buffer,
      originalName,
      mimetype,
      folder,
      imageUsage,
      userId,
      eventId
    }, redisConfig.queueOptions);

    logger.info('Added image optimization job to queue', {
      jobId: job.id,
      userId: userId,
      originalName: originalName
    });

    return job.id;
  } catch (error) {
    logger.error('Failed to add image optimization job', {
      error: error.message,
      originalName: originalName,
      userId: userId
    });

    // Attempt fallback processing if queue add fails
    try {
      logger.warn('Queue addition failed, attempting direct fallback...');
      const result = await processImageJobDirectly({
        buffer,
        originalName,
        mimetype,
        folder,
        imageUsage,
        userId,
        eventId
      });
      return result.publicUrl || "fallback-" + Math.random().toString(36).substring(7);
    } catch (e) {
      throw error;
    }
  }
};

module.exports = {
  imageOptimizationQueue,
  addImageOptimizationJob,
  isRedisAvailable: () => isRedisAvailable
};
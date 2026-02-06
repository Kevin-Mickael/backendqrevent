require('dotenv').config();

module.exports = {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || null,
    // Optional: for connecting to Redis clusters
    cluster: process.env.REDIS_CLUSTER === 'true',
    // Optional: for connecting via sentinel
    sentinel: process.env.REDIS_SENTINEL === 'true',
    // Connection options
    opts: {
      // Retry configuration
      retryDelayOnFailover: 1000,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true, // Don't connect immediately
      // Additional options to handle connection issues gracefully
      enableOfflineQueue: false, // Don't queue commands when Redis is offline
      connectTimeout: 50000, // 50 seconds
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 1000,
      retryStrategy: (times) => {
        // Exponential backoff: 1s, 2s, 4s, 8s, etc. up to 10s
        const delay = Math.min(1000 * Math.pow(2, times - 1), 10000);
        console.log(`Redis connection attempt ${times}, retrying in ${delay}ms`);
        return delay;
      }
    }
  },
  // Redis URL for direct connection string
  redisUrl: process.env.REDIS_URL || null,

  // Queue configuration
  queueOptions: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: true,
      removeOnFail: 100
    }
  }
};
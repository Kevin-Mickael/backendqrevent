/**
 * 🛡️ Database Health Monitor - QR Event
 * Monitors Supabase connection health and performance
 */

const { supabaseService } = require('../config/supabase');
const logger = require('./logger');

class DatabaseHealthMonitor {
  constructor() {
    this.isHealthy = true;
    this.lastCheck = null;
    this.consecutiveFailures = 0;
    this.maxFailures = 3;
    this.checkInterval = 60000; // 60 seconds
    this.stats = {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      avgResponseTime: 0
    };
  }

  /**
   * Perform health check
   */
  async checkHealth() {
    const startTime = Date.now();
    
    try {
      // Simple health check query
      const { error, status } = await supabaseService
        .from('users')
        .select('count', { count: 'exact', head: true });

      const responseTime = Date.now() - startTime;
      
      if (error) {
        this.recordFailure(error, responseTime);
        return false;
      }

      this.recordSuccess(responseTime);
      return true;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.recordFailure(error, responseTime);
      return false;
    }
  }

  /**
   * Record successful query
   */
  recordSuccess(responseTime) {
    this.stats.totalQueries++;
    this.stats.successfulQueries++;
    this.updateAvgResponseTime(responseTime);
    
    if (this.consecutiveFailures >= this.maxFailures) {
      logger.info('✅ Database connection restored', {
        consecutiveFailures: this.consecutiveFailures,
        responseTime: `${responseTime}ms`
      });
    }
    
    this.consecutiveFailures = 0;
    this.isHealthy = true;
    this.lastCheck = new Date();
  }

  /**
   * Record failed query
   */
  recordFailure(error, responseTime) {
    this.stats.totalQueries++;
    this.stats.failedQueries++;
    this.updateAvgResponseTime(responseTime);
    
    this.consecutiveFailures++;
    
    if (this.consecutiveFailures >= this.maxFailures && this.isHealthy) {
      this.isHealthy = false;
      logger.error('🚨 Database connection unhealthy', {
        consecutiveFailures: this.consecutiveFailures,
        error: error.message,
        responseTime: `${responseTime}ms`
      });
    }
    
    this.lastCheck = new Date();
  }

  /**
   * Update average response time
   */
  updateAvgResponseTime(responseTime) {
    if (this.stats.totalQueries === 1) {
      this.stats.avgResponseTime = responseTime;
    } else {
      // Exponential moving average
      this.stats.avgResponseTime = (this.stats.avgResponseTime * 0.9) + (responseTime * 0.1);
    }
  }

  /**
   * Get health status
   */
  getStatus() {
    const successRate = this.stats.totalQueries > 0 
      ? (this.stats.successfulQueries / this.stats.totalQueries * 100).toFixed(2)
      : 0;

    return {
      isHealthy: this.isHealthy,
      lastCheck: this.lastCheck,
      consecutiveFailures: this.consecutiveFailures,
      stats: {
        ...this.stats,
        successRate: `${successRate}%`,
        avgResponseTime: `${Math.round(this.stats.avgResponseTime)}ms`
      },
      status: this.isHealthy ? 'healthy' : 'unhealthy'
    };
  }

  /**
   * Start periodic health monitoring
   */
  startMonitoring() {
    // Initial check
    this.checkHealth();

    // Periodic checks
    setInterval(async () => {
      await this.checkHealth();
    }, this.checkInterval);

    logger.info(`🩺 Database health monitoring started (interval: ${this.checkInterval}ms)`);
  }

  /**
   * Check if database is currently healthy
   */
  isCurrentlyHealthy() {
    return this.isHealthy;
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      timestamp: new Date().toISOString(),
      ...this.getStatus()
    };
  }
}

// Singleton instance
const dbHealthMonitor = new DatabaseHealthMonitor();

module.exports = {
  dbHealthMonitor,
  DatabaseHealthMonitor
};
/**
 * 🔥 CIRCUIT BREAKER PATTERN
 * 
 * Protège le système contre les cascades de défaillance.
 * Si Supabase est en panne/lent, le circuit s'ouvre et les requêtes
 * échouent rapidement au lieu de rester en attente.
 */

const logger = require('./logger');

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;        // Ouvrir après 5 échecs
    this.resetTimeout = options.resetTimeout || 30000;            // Réessayer après 30s
    this.halfOpenMaxCalls = options.halfOpenMaxCalls || 3;        // Nombre de tests en half-open
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = Date.now();
    
    // Stats
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      rejectedCalls: 0,
      stateChanges: 0
    };
    
    logger.info(`Circuit Breaker '${name}' initialized`, {
      failureThreshold: this.failureThreshold,
      resetTimeout: this.resetTimeout
    });
  }
  
  async execute(operation, ...args) {
    this.stats.totalCalls++;
    
    // Vérifier l'état du circuit
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        this.stats.rejectedCalls++;
        throw new Error(`Circuit '${this.name}' is OPEN - Service temporarily unavailable`);
      }
      // Passer en HALF_OPEN pour tester
      this.transitionTo('HALF_OPEN');
    }
    
    try {
      const result = await operation(...args);
      this.onSuccess();
      this.stats.successfulCalls++;
      return result;
    } catch (error) {
      this.onFailure();
      this.stats.failedCalls++;
      throw error;
    }
  }
  
  onSuccess() {
    this.failureCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxCalls) {
        this.transitionTo('CLOSED');
      }
    }
  }
  
  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }
  
  transitionTo(newState) {
    if (this.state !== newState) {
      logger.warn(`Circuit Breaker '${this.name}' state change: ${this.state} -> ${newState}`, {
        failureCount: this.failureCount,
        successCount: this.successCount,
        stats: this.stats
      });
      
      this.state = newState;
      this.stats.stateChanges++;
      
      if (newState === 'OPEN') {
        this.nextAttempt = Date.now() + this.resetTimeout;
        this.successCount = 0;
      } else if (newState === 'CLOSED') {
        this.failureCount = 0;
        this.successCount = 0;
      } else if (newState === 'HALF_OPEN') {
        this.successCount = 0;
      }
    }
  }
  
  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      stats: this.stats,
      nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null
    };
  }
}

// Circuit breakers par défaut pour les services critiques
const circuitBreakers = {
  supabase: new CircuitBreaker('supabase', {
    failureThreshold: 5,
    resetTimeout: 30000,
    halfOpenMaxCalls: 3
  }),
  redis: new CircuitBreaker('redis', {
    failureThreshold: 3,
    resetTimeout: 15000,
    halfOpenMaxCalls: 2
  }),
  r2: new CircuitBreaker('r2', {
    failureThreshold: 5,
    resetTimeout: 30000,
    halfOpenMaxCalls: 3
  })
};

// Helper pour wrapper une fonction avec circuit breaker
const withCircuitBreaker = (serviceName, operation) => {
  const breaker = circuitBreakers[serviceName];
  if (!breaker) {
    throw new Error(`Unknown circuit breaker: ${serviceName}`);
  }
  return (...args) => breaker.execute(operation, ...args);
};

// Health check endpoint
const getCircuitBreakerHealth = () => {
  return Object.values(circuitBreakers).map(cb => cb.getState());
};

module.exports = {
  CircuitBreaker,
  circuitBreakers,
  withCircuitBreaker,
  getCircuitBreakerHealth
};

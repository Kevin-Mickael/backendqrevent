/**
 * 🛡️ Secrets Manager - QR Event
 * Secure secrets management with environment validation
 */

const crypto = require('crypto');
const logger = require('./logger');

class SecretsManager {
  constructor() {
    this.secrets = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize secrets with validation
   */
  async initialize() {
    if (this.isInitialized) return;

    const requiredSecrets = [
      'JWT_SECRET',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY'
    ];

    const optionalSecrets = [
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'REDIS_PASSWORD'
    ];

    // Validate required secrets
    for (const secretName of requiredSecrets) {
      const value = process.env[secretName];
      if (!value) {
        throw new Error(`Required secret ${secretName} is not set`);
      }
      this.validateSecret(secretName, value);
      this.secrets.set(secretName, value);
    }

    // Load optional secrets if available
    for (const secretName of optionalSecrets) {
      const value = process.env[secretName];
      if (value) {
        this.validateSecret(secretName, value);
        this.secrets.set(secretName, value);
      }
    }

    this.isInitialized = true;
    logger.info(`✅ Secrets manager initialized with ${this.secrets.size} secrets`);
  }

  /**
   * Validate secret strength and format
   */
  validateSecret(name, value) {
    if (!value || typeof value !== 'string') {
      throw new Error(`Secret ${name} must be a non-empty string`);
    }

    switch (name) {
      case 'JWT_SECRET':
        this.validateJwtSecret(value);
        break;
      case 'SUPABASE_SERVICE_ROLE_KEY':
        this.validateSupabaseKey(value);
        break;
      case 'R2_SECRET_ACCESS_KEY':
        this.validateR2Secret(value);
        break;
    }
  }

  /**
   * Validate JWT secret strength
   */
  validateJwtSecret(secret) {
    const isProduction = process.env.NODE_ENV === 'production';
    const minLength = isProduction ? 64 : 32;

    if (secret.length < minLength) {
      throw new Error(`JWT_SECRET too short (${secret.length} < ${minLength})`);
    }

    // Check entropy
    const entropy = this.calculateEntropy(secret);
    const minEntropy = isProduction ? 4.5 : 4.0; // bits per character

    if (entropy < minEntropy) {
      const message = `JWT_SECRET entropy too low (${entropy.toFixed(2)} < ${minEntropy})`;
      if (isProduction) {
        throw new Error(message);
      } else {
        logger.warn(`⚠️ ${message}`);
      }
    }
  }

  /**
   * Validate Supabase service role key format
   */
  validateSupabaseKey(key) {
    if (!key.startsWith('eyJ')) {
      throw new Error('Invalid Supabase service role key format');
    }
    
    try {
      // Try to decode the JWT header
      const parts = key.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }
      
      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
      if (!header.alg || !header.typ) {
        throw new Error('Invalid JWT header');
      }
    } catch (error) {
      throw new Error(`Invalid Supabase key: ${error.message}`);
    }
  }

  /**
   * Validate R2 secret format
   */
  validateR2Secret(secret) {
    // R2 secrets are typically 40+ chars, base64-like
    if (secret.length < 20) {
      throw new Error('R2_SECRET_ACCESS_KEY too short');
    }

    if (!/^[A-Za-z0-9+/=]+$/.test(secret)) {
      throw new Error('R2_SECRET_ACCESS_KEY contains invalid characters');
    }
  }

  /**
   * Calculate entropy (bits per character)
   */
  calculateEntropy(str) {
    const freqMap = {};
    for (let char of str) {
      freqMap[char] = (freqMap[char] || 0) + 1;
    }

    let entropy = 0;
    for (let char in freqMap) {
      const freq = freqMap[char] / str.length;
      entropy -= freq * Math.log2(freq);
    }

    return entropy;
  }

  /**
   * Get a secret value safely
   */
  getSecret(name) {
    if (!this.isInitialized) {
      throw new Error('Secrets manager not initialized');
    }

    const value = this.secrets.get(name);
    if (!value) {
      throw new Error(`Secret ${name} not found`);
    }

    return value;
  }

  /**
   * Check if a secret exists
   */
  hasSecret(name) {
    return this.secrets.has(name);
  }

  /**
   * Generate a secure random secret
   */
  static generateSecureSecret(length = 64) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Mask secret for logging (show only first/last chars)
   */
  static maskSecret(secret, visibleChars = 4) {
    if (!secret || secret.length <= visibleChars * 2) {
      return '[HIDDEN]';
    }
    
    const start = secret.substring(0, visibleChars);
    const end = secret.substring(secret.length - visibleChars);
    const middle = '*'.repeat(Math.min(secret.length - (visibleChars * 2), 20));
    
    return `${start}${middle}${end}`;
  }

  /**
   * Rotate a secret (for scheduled rotation)
   */
  async rotateSecret(name, newValue) {
    if (!this.isInitialized) {
      throw new Error('Secrets manager not initialized');
    }

    this.validateSecret(name, newValue);
    const oldValue = this.secrets.get(name);
    this.secrets.set(name, newValue);

    logger.info(`🔄 Secret ${name} rotated`, {
      old: SecretsManager.maskSecret(oldValue),
      new: SecretsManager.maskSecret(newValue)
    });

    return true;
  }

  /**
   * Get secrets health status
   */
  getHealthStatus() {
    const status = {
      initialized: this.isInitialized,
      secretsCount: this.secrets.size,
      environment: process.env.NODE_ENV,
      checks: []
    };

    for (const [name, value] of this.secrets) {
      try {
        this.validateSecret(name, value);
        status.checks.push({ secret: name, status: 'healthy' });
      } catch (error) {
        status.checks.push({ 
          secret: name, 
          status: 'unhealthy', 
          error: error.message 
        });
      }
    }

    return status;
  }
}

// Singleton instance
const secretsManager = new SecretsManager();

module.exports = {
  secretsManager,
  SecretsManager
};
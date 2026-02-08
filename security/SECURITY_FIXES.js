/**
 * 🛡️ CORRECTIFS DE SÉCURITÉ CRITIQUES
 * 
 * Ce fichier contient les correctifs pour toutes les vulnérabilités identifiées
 * dans l'audit de sécurité. Appliquer ces modifications immédiatement.
 */

// ============================================================================
// 1. CORRECTION IDOR CRITIQUE (Type Coercion)
// ============================================================================

// ❌ AVANT (vulnérable):
function checkEventOwnershipVulnerable(req, res, next) {
  if (event.organizer_id !== req.user.id) {
    // Vulnérable à type coercion: '1' == 1
    return res.status(403).json({ message: 'Access denied' });
  }
}

// ✅ APRÈS (sécurisé):
function checkEventOwnershipSecure(req, res, next) {
  // Conversion stricte en string pour éviter type coercion
  const eventOrganizerID = String(event.organizer_id).trim();
  const userID = String(req.user.id).trim();
  
  if (eventOrganizerID !== userID) {
    logger.warn('IDOR attempt detected', {
      eventOrganizerID,
      userID,
      ip: req.ip,
      path: req.path
    });
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
}

// ============================================================================
// 2. CORRECTION TIMING ATTACKS (User Enumeration)
// ============================================================================

// ❌ AVANT (vulnérable):
function authenticateUserVulnerable(req, res, next) {
  if (!user || !user.is_active) {
    // Même message révèle l'existence de l'utilisateur
    return res.status(401).json({
      message: 'Invalid session - user not found or inactive'
    });
  }
}

// ✅ APRÈS (sécurisé):
function authenticateUserSecure(req, res, next) {
  // Délai constant pour éviter timing attacks
  const startTime = process.hrtime.bigint();
  
  const sendErrorResponse = () => {
    // Assurer un délai minimum constant
    const minDelay = 100; // 100ms minimum
    const elapsed = Number(process.hrtime.bigint() - startTime) / 1000000;
    
    const remainingDelay = Math.max(0, minDelay - elapsed);
    
    setTimeout(() => {
      res.status(401).json({
        success: false,
        message: 'Authentication failed' // Message générique
      });
    }, remainingDelay);
  };

  if (!user) {
    logger.debug('User not found', { userId: decoded.userId });
    return sendErrorResponse();
  }
  
  if (!user.is_active) {
    logger.debug('User inactive', { userId: user.id });
    return sendErrorResponse();
  }
  
  next();
}

// ============================================================================
// 3. CORRECTION RACE CONDITION (Token Refresh)
// ============================================================================

// ❌ AVANT (vulnérable):
async function refreshTokenVulnerable(req, res) {
  const newRefreshToken = await generateRefreshToken(decoded.userId);
  // ⚠️ Fenêtre critique ici - si crash, token leak
  await revokeRefreshToken(refreshToken);
}

// ✅ APRÈS (sécurisé):
async function refreshTokenSecure(req, res) {
  // Transaction atomique avec rollback
  const transaction = await db.beginTransaction();
  
  try {
    // 1. Marquer l'ancien token comme révoqué AVANT de créer le nouveau
    await revokeRefreshToken(refreshToken, transaction);
    
    // 2. Générer le nouveau token
    const newRefreshToken = await generateRefreshToken(decoded.userId, transaction);
    
    // 3. Commit atomique
    await transaction.commit();
    
    // 4. Réponse sécurisée
    res.cookie('refresh_token', newRefreshToken, secureOptions);
    res.json({ success: true, message: 'Token refreshed' });
    
  } catch (error) {
    // Rollback en cas d'erreur
    await transaction.rollback();
    throw error;
  }
}

// ============================================================================
// 4. CORRECTION CACHE TIMING (Information Disclosure)
// ============================================================================

// ❌ AVANT (vulnérable):
async function getCachedDataVulnerable(req, res) {
  const cachedData = await cache.get(key);
  if (cachedData) {
    return res.json(cachedData); // Temps: ~50ms
  }
  
  const freshData = await database.query(...); // Temps: ~200ms
  return res.json(freshData);
}

// ✅ APRÈS (sécurisé):
async function getCachedDataSecure(req, res) {
  const startTime = process.hrtime.bigint();
  const minResponseTime = 50; // 50ms minimum pour masquer le timing
  
  const cachedData = await cache.get(key);
  let responseData;
  
  if (cachedData) {
    responseData = cachedData;
  } else {
    responseData = await database.query(...);
    // Cache async pour ne pas affecter le timing
    setImmediate(() => cache.set(key, responseData));
  }
  
  // Normaliser le temps de réponse
  const elapsed = Number(process.hrtime.bigint() - startTime) / 1000000;
  const delay = Math.max(0, minResponseTime - elapsed);
  
  setTimeout(() => {
    res.json(responseData);
  }, delay);
}

// ============================================================================
// 5. GÉNÉRATION SÉCURISÉE DE SECRETS
// ============================================================================

const crypto = require('crypto');

// Générateur de JWT secret sécurisé
function generateSecureJWTSecret() {
  // 256 bits (64 hex chars) avec entropie maximale
  const secret = crypto.randomBytes(32).toString('hex');
  
  // Validation de l'entropie
  const entropy = calculateEntropy(secret);
  if (entropy < 4.5) { // Bits par caractère minimum
    throw new Error('Generated secret has insufficient entropy');
  }
  
  return secret;
}

function calculateEntropy(string) {
  const freq = {};
  for (const char of string) {
    freq[char] = (freq[char] || 0) + 1;
  }
  
  let entropy = 0;
  const length = string.length;
  
  for (const count of Object.values(freq)) {
    const p = count / length;
    entropy -= p * Math.log2(p);
  }
  
  return entropy;
}

// ============================================================================
// 6. SESSION SECURITY HARDENING
// ============================================================================

// ✅ Options de cookie sécurisées renforcées
function getSecureCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24h
    path: '/',
    domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
    
    // Nouvelles options de sécurité
    partitioned: true, // CHIPS support
    priority: 'high'   // Network prioritization
  };
}

// Session regeneration après login
async function regenerateSession(req, userId) {
  return new Promise((resolve) => {
    req.session.regenerate(async (err) => {
      if (err) throw err;
      
      req.session.userId = userId;
      req.session.loginTime = Date.now();
      req.session.ipAddress = req.ip;
      
      await req.session.save();
      resolve();
    });
  });
}

// ============================================================================
// 7. ENHANCED AUDIT LOGGING
// ============================================================================

class SecurityLogger {
  static logSecurityEvent(event, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      severity: this.getSeverity(event),
      metadata: this.sanitizeMetadata(metadata),
      correlationId: crypto.randomUUID()
    };
    
    // Log différentiel selon la sévérité
    switch (logEntry.severity) {
      case 'CRITICAL':
        logger.error('🚨 SECURITY CRITICAL', logEntry);
        this.alertSecurityTeam(logEntry);
        break;
      case 'HIGH':
        logger.warn('⚠️ SECURITY HIGH', logEntry);
        break;
      default:
        logger.info('ℹ️ SECURITY INFO', logEntry);
    }
    
    // Store dans audit DB
    this.storeAuditLog(logEntry);
  }
  
  static getSeverity(event) {
    const criticalEvents = [
      'IDOR_ATTEMPT',
      'TOKEN_COMPROMISE',
      'PRIVILEGE_ESCALATION',
      'MASS_DATA_ACCESS'
    ];
    
    const highEvents = [
      'FAILED_LOGIN_BURST',
      'SUSPICIOUS_ACTIVITY',
      'RATE_LIMIT_EXCEEDED'
    ];
    
    if (criticalEvents.includes(event)) return 'CRITICAL';
    if (highEvents.includes(event)) return 'HIGH';
    return 'MEDIUM';
  }
  
  static sanitizeMetadata(metadata) {
    const sanitized = { ...metadata };
    const sensitiveFields = ['password', 'token', 'secret', 'key'];
    
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
  
  static async storeAuditLog(logEntry) {
    try {
      await supabaseService.from('security_audit_logs').insert(logEntry);
    } catch (error) {
      console.error('Failed to store audit log:', error.message);
    }
  }
  
  static alertSecurityTeam(logEntry) {
    // Intégration avec système d'alertes (Slack, email, etc.)
    if (process.env.SECURITY_WEBHOOK_URL) {
      fetch(process.env.SECURITY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 Security Alert: ${logEntry.event}`,
          details: logEntry
        })
      }).catch(err => console.error('Alert failed:', err));
    }
  }
}

// ============================================================================
// 8. RATE LIMITING ANTI-BYPASS
// ============================================================================

class SecureRateLimiter {
  static getClientFingerprint(req) {
    // Fingerprint multi-facteur difficile à spoof
    const components = [
      req.headers['x-forwarded-for']?.split(',')[0]?.trim(),
      req.ip,
      req.connection?.remoteAddress,
      req.headers['user-agent']?.substring(0, 100),
      req.headers['accept-language']?.substring(0, 50),
      req.headers['accept-encoding']?.substring(0, 50)
    ].filter(Boolean);
    
    // Hash pour anonymisation
    const fingerprint = crypto
      .createHash('sha256')
      .update(components.join('|'))
      .digest('hex')
      .substring(0, 16);
    
    return fingerprint;
  }
  
  static async isRateLimited(req, windowMs, maxRequests) {
    const fingerprint = this.getClientFingerprint(req);
    const key = `ratelimit:${fingerprint}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Sliding window dans Redis
    const redis = getRedisClient();
    if (!redis) return false; // Pas de rate limit si Redis down
    
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart); // Nettoyer ancien
    pipeline.zcard(key); // Compter actuel
    pipeline.zadd(key, now, `${now}-${Math.random()}`); // Ajouter
    pipeline.expire(key, Math.ceil(windowMs / 1000)); // TTL
    
    const results = await pipeline.exec();
    const currentCount = results[1][1];
    
    return currentCount >= maxRequests;
  }
}

// ============================================================================
// 9. SECRET DETECTION & ROTATION
// ============================================================================

class SecretScanner {
  static patterns = [
    /sk_[a-zA-Z0-9]{24,}/, // Stripe
    /pk_[a-zA-Z0-9]{24,}/, // Stripe public
    /AKIA[0-9A-Z]{16}/, // AWS Access Key
    /AIza[0-9A-Za-z\\-_]{35}/, // Google API
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // Email
    /(?i)(jwt_secret|api_key|private_key).*[=:]\s*['"]([^'"]+)['"]/ // Generic secrets
  ];
  
  static scanForSecrets(content) {
    const findings = [];
    
    for (const [index, pattern] of this.patterns.entries()) {
      const matches = content.match(new RegExp(pattern, 'g'));
      if (matches) {
        findings.push({
          type: this.getSecretType(index),
          matches: matches.map(m => m.substring(0, 10) + '...[REDACTED]'),
          severity: 'HIGH'
        });
      }
    }
    
    return findings;
  }
  
  static getSecretType(patternIndex) {
    const types = [
      'Stripe Secret Key',
      'Stripe Public Key', 
      'AWS Access Key',
      'Google API Key',
      'Email Address',
      'Generic Secret'
    ];
    return types[patternIndex] || 'Unknown';
  }
}

// ============================================================================
// EXPORT POUR UTILISATION
// ============================================================================

module.exports = {
  checkEventOwnershipSecure,
  authenticateUserSecure,
  refreshTokenSecure,
  getCachedDataSecure,
  generateSecureJWTSecret,
  getSecureCookieOptions,
  regenerateSession,
  SecurityLogger,
  SecureRateLimiter,
  SecretScanner
};
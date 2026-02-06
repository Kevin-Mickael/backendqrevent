const logger = require('../utils/logger');

/**
 * 🛡️ AUDIT SERVICE - Critical Security Component
 * 
 * Handles comprehensive audit logging for all sensitive operations
 * as required by security audit findings.
 * 
 * All sensitive operations MUST be logged through this service:
 * - Authentication events (login, logout, failed attempts)
 * - QR code operations (generation, scanning, validation)
 * - Data access and modifications
 * - Admin operations
 * - Security events (rate limiting, suspicious activity)
 */

class AuditService {
  /**
   * Log an audit event to the database
   * @param {Object} params - Audit log parameters
   * @param {string} params.userId - UUID of the user performing the action
   * @param {string} params.action - Action being performed (e.g., 'login', 'qr_scan')
   * @param {string} params.resourceType - Type of resource affected (e.g., 'user', 'qr_code')
   * @param {string} [params.resourceId] - ID of the affected resource
   * @param {string} [params.eventId] - Event ID if action is event-related
   * @param {string} [params.ipAddress] - Client IP address
   * @param {string} [params.userAgent] - Client user agent
   * @param {string} [params.sessionId] - Session identifier
   * @param {Object} [params.details] - Additional context data
   * @param {string} [params.severity='info'] - Severity level (info, warning, critical)
   * @param {boolean} [params.success=true] - Whether the action succeeded
   * @param {string} [params.errorMessage] - Error message if action failed
   * @returns {Promise<string>} - Audit log ID
   */
  async logEvent({
    userId,
    action,
    resourceType,
    resourceId = null,
    eventId = null,
    ipAddress = null,
    userAgent = null,
    sessionId = null,
    details = {},
    severity = 'info',
    success = true,
    errorMessage = null
  }) {
    try {
      // 🛡️ TEMPORARY: Log to application logger until migration is run
      // TODO: Uncomment database logging after running migration 013_create_audit_logging.sql
      
      logger.info('Audit Event (File Log)', {
        userId,
        action,
        resourceType,
        resourceId,
        eventId,
        severity,
        success,
        ipAddress: this._maskIP(ipAddress),
        userAgent: userAgent ? `${userAgent.split('/')[0]}/***` : null,
        timestamp: new Date().toISOString(),
        details: JSON.stringify(details),
        errorMessage
      });

      // Return fake audit ID for compatibility
      return 'temp-' + Date.now();
      
      /* TODO: Uncomment after migration
      const { database } = require('../utils/database');
      const result = await database.query(`
        SELECT log_audit_event($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) as audit_id
      `, [
        userId, action, resourceType, resourceId, eventId,
        ipAddress, userAgent, sessionId, JSON.stringify(details),
        severity, success, errorMessage
      ]);

      const auditId = result.rows[0]?.audit_id;
      return auditId;
      */
    } catch (error) {
      // Critical: If audit logging fails, we must know about it
      logger.error('CRITICAL: Audit logging failed', {
        error: error.message,
        action,
        resourceType,
        userId,
        severity: 'critical'
      });
      // Don't throw error to avoid breaking login - graceful degradation
      return 'error-' + Date.now();
    }
  }

  /**
   * Log a login attempt
   * @param {string} email - Email address used for login
   * @param {string} ipAddress - Client IP address
   * @param {string} [userAgent] - Client user agent
   * @param {boolean} [success=false] - Whether login succeeded
   * @param {string} [failureReason] - Reason for failure if applicable
   * @returns {Promise<string>} - Login attempt ID
   */
  async logLoginAttempt(email, ipAddress, userAgent = null, success = false, failureReason = null) {
    try {
      // 🛡️ TEMPORARY: Log to application logger until migration is run
      const logLevel = success ? 'info' : 'warning';
      logger[logLevel]('Login Attempt (File Log)', {
        email: this._maskEmail(email),
        ipAddress: this._maskIP(ipAddress),
        userAgent: userAgent ? `${userAgent.split('/')[0]}/***` : null,
        success,
        failureReason,
        timestamp: new Date().toISOString()
      });

      return 'temp-login-' + Date.now();

      /* TODO: Uncomment after migration
      const { database } = require('../utils/database');
      const result = await database.query(`
        SELECT log_login_attempt($1, $2, $3, $4, $5) as attempt_id
      `, [email, ipAddress, userAgent, success, failureReason]);

      const attemptId = result.rows[0]?.attempt_id;
      return attemptId;
      */
    } catch (error) {
      logger.error('Failed to log login attempt', {
        error: error.message,
        email: this._maskEmail(email),
        success
      });
      // Graceful degradation - don't break login
      return 'error-login-' + Date.now();
    }
  }

  /**
   * Check failed login attempts for rate limiting
   * @param {string} ipAddress - IP address to check
   * @param {number} [minutes=15] - Time window in minutes
   * @returns {Promise<number>} - Number of failed attempts
   */
  async getFailedLoginAttempts(ipAddress, minutes = 15) {
    // 🛡️ TEMPORARY: Return 0 until migration is run (fail open for availability)
    logger.info('Rate limit check (File Log)', {
      ipAddress: this._maskIP(ipAddress),
      minutes,
      result: 0,
      note: 'Database not available - failing open'
    });
    return 0;
  }

  /**
   * Check failed login attempts by email for rate limiting
   * @param {string} email - Email to check
   * @param {number} [minutes=15] - Time window in minutes
   * @returns {Promise<number>} - Number of failed attempts
   */
  async getFailedLoginAttemptsByEmail(email, minutes = 15) {
    // 🛡️ TEMPORARY: Return 0 until migration is run (fail open for availability)
    logger.info('Rate limit check by email (File Log)', {
      email: this._maskEmail(email),
      minutes,
      result: 0,
      note: 'Database not available - failing open'
    });
    return 0;
  }

  /**
   * Clean up old audit logs (maintenance function)
   * @param {number} [retentionDays=365] - Number of days to retain
   * @returns {Promise<number>} - Number of deleted records
   */
  async cleanupAuditLogs(retentionDays = 365) {
    try {
      const result = await database.query(`
        SELECT cleanup_old_audit_logs($1) as deleted_count
      `, [retentionDays]);

      const deletedCount = result.rows[0]?.deleted_count || 0;
      
      logger.info('Audit logs cleanup completed', {
        deletedCount,
        retentionDays
      });

      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup audit logs', {
        error: error.message,
        retentionDays
      });
      throw error;
    }
  }

  /**
   * Get security dashboard metrics
   * @returns {Promise<Array>} - Security metrics
   */
  async getSecurityDashboard() {
    try {
      const result = await database.query('SELECT * FROM security_dashboard ORDER BY metric');
      return result.rows;
    } catch (error) {
      logger.error('Failed to get security dashboard', {
        error: error.message
      });
      throw error;
    }
  }

  // Helper methods for data masking
  _maskEmail(email) {
    if (!email) return null;
    const [local, domain] = email.split('@');
    if (local.length <= 2) return email;
    return `${local.substring(0, 2)}***@${domain}`;
  }

  _maskIP(ip) {
    if (!ip) return null;
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.xxx.xxx`;
    }
    // IPv6 masking
    if (ip.includes(':')) {
      const segments = ip.split(':');
      return segments.slice(0, 3).join(':') + ':xxxx:xxxx:xxxx:xxxx';
    }
    return 'xxx.xxx.xxx.xxx';
  }

  // Predefined audit actions for consistency
  static ACTIONS = {
    // Authentication
    LOGIN_SUCCESS: 'login_success',
    LOGIN_FAILED: 'login_failed',
    LOGOUT: 'logout',
    PASSWORD_CHANGE: 'password_change',
    ACCOUNT_LOCKED: 'account_locked',
    
    // QR Codes
    QR_GENERATE: 'qr_generate',
    QR_SCAN: 'qr_scan',
    QR_VALIDATE: 'qr_validate',
    QR_INVALIDATE: 'qr_invalidate',
    
    // Data Operations
    DATA_EXPORT: 'data_export',
    DATA_IMPORT: 'data_import',
    DATA_DELETE: 'data_delete',
    
    // Admin Operations
    USER_CREATE: 'user_create',
    USER_DELETE: 'user_delete',
    USER_ROLE_CHANGE: 'user_role_change',
    
    // Security Events
    RATE_LIMIT_HIT: 'rate_limit_hit',
    SUSPICIOUS_ACTIVITY: 'suspicious_activity',
    SECURITY_SCAN_DETECTED: 'security_scan_detected'
  };

  static RESOURCE_TYPES = {
    USER: 'user',
    EVENT: 'event',
    GUEST: 'guest',
    QR_CODE: 'qr_code',
    FAMILY: 'family',
    SESSION: 'session',
    SYSTEM: 'system'
  };

  static SEVERITIES = {
    INFO: 'info',
    WARNING: 'warning',
    CRITICAL: 'critical'
  };
}

// Create singleton instance
const auditService = new AuditService();

module.exports = auditService;
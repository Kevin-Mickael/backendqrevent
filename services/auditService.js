const logger = require('../utils/logger');
const { createClient } = require('@supabase/supabase-js');

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

// Initialize Supabase client for audit logging
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;

try {
  if (supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey);
    logger.info('AuditService: Supabase client initialized for persistent logging');
  } else {
    logger.warn('AuditService: Supabase credentials missing, falling back to file logging');
  }
} catch (error) {
  logger.error('AuditService: Failed to initialize Supabase client', { error: error.message });
}

class AuditService {
  /**
   * Log an audit event to the database
   * @param {Object} params - Audit log parameters
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
      // Try database logging first
      if (supabase) {
        const { data, error } = await supabase.rpc('log_audit_event', {
          p_user_id: userId,
          p_action: action,
          p_resource_type: resourceType,
          p_resource_id: resourceId,
          p_event_id: eventId,
          p_ip_address: ipAddress,
          p_user_agent: userAgent,
          p_session_id: sessionId,
          p_details: details,
          p_severity: severity,
          p_success: success,
          p_error_message: errorMessage
        });

        if (error) {
          // Fallback to file logging if RPC fails (e.g., migration not run yet)
          logger.warn('AuditService: RPC failed, falling back to file logging', { error: error.message });
          return this._logToFile({ userId, action, resourceType, resourceId, eventId, ipAddress, userAgent, details, severity, success, errorMessage });
        }

        return data; // Returns audit_id
      }

      // Fallback to file logging
      return this._logToFile({ userId, action, resourceType, resourceId, eventId, ipAddress, userAgent, details, severity, success, errorMessage });
    } catch (error) {
      logger.error('CRITICAL: Audit logging failed', {
        error: error.message,
        action,
        resourceType,
        userId,
        severity: 'critical'
      });
      // Graceful degradation - don't break the calling function
      return 'error-' + Date.now();
    }
  }

  /**
   * Fallback method - log to file
   */
  _logToFile({ userId, action, resourceType, resourceId, eventId, ipAddress, userAgent, details, severity, success, errorMessage }) {
    logger.info('Audit Event', {
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
    return 'file-' + Date.now();
  }

  /**
   * Log a login attempt
   */
  async logLoginAttempt(email, ipAddress, userAgent = null, success = false, failureReason = null) {
    try {
      if (supabase) {
        const { data, error } = await supabase.rpc('log_login_attempt', {
          p_email: email,
          p_ip_address: ipAddress,
          p_user_agent: userAgent,
          p_success: success,
          p_failure_reason: failureReason
        });

        if (error) {
          logger.warn('AuditService: Login attempt RPC failed', { error: error.message });
          return this._logLoginToFile(email, ipAddress, userAgent, success, failureReason);
        }

        return data;
      }

      return this._logLoginToFile(email, ipAddress, userAgent, success, failureReason);
    } catch (error) {
      logger.error('Failed to log login attempt', {
        error: error.message,
        email: this._maskEmail(email),
        success
      });
      return 'error-login-' + Date.now();
    }
  }

  /**
   * Fallback for login attempt logging
   */
  _logLoginToFile(email, ipAddress, userAgent, success, failureReason) {
    const logLevel = success ? 'info' : 'warn';
    logger[logLevel]('Login Attempt', {
      email: this._maskEmail(email),
      ipAddress: this._maskIP(ipAddress),
      userAgent: userAgent ? `${userAgent.split('/')[0]}/***` : null,
      success,
      failureReason,
      timestamp: new Date().toISOString()
    });
    return 'file-login-' + Date.now();
  }

  /**
   * Check failed login attempts for rate limiting
   */
  async getFailedLoginAttempts(ipAddress, minutes = 15) {
    try {
      if (supabase) {
        const { data, error } = await supabase.rpc('get_failed_login_attempts', {
          p_ip_address: ipAddress,
          p_minutes: minutes
        });

        if (error) {
          logger.warn('Rate limit check failed', { error: error.message });
          return 0; // Fail open for availability
        }

        return data || 0;
      }

      return 0; // No database, fail open
    } catch (error) {
      logger.error('Failed to check login attempts', { error: error.message });
      return 0;
    }
  }

  /**
   * Check failed login attempts by email
   */
  async getFailedLoginAttemptsByEmail(email, minutes = 15) {
    try {
      if (supabase) {
        const { data, error } = await supabase.rpc('get_failed_login_attempts_by_email', {
          p_email: email,
          p_minutes: minutes
        });

        if (error) {
          logger.warn('Rate limit check by email failed', { error: error.message });
          return 0;
        }

        return data || 0;
      }

      return 0;
    } catch (error) {
      logger.error('Failed to check login attempts by email', { error: error.message });
      return 0;
    }
  }

  /**
   * Clean up old audit logs (maintenance function)
   */
  async cleanupAuditLogs(retentionDays = 365) {
    try {
      if (!supabase) {
        throw new Error('Database not available');
      }

      const { data, error } = await supabase.rpc('cleanup_old_audit_logs', {
        p_retention_days: retentionDays
      });

      if (error) throw error;

      const deletedCount = data || 0;
      logger.info('Audit logs cleanup completed', { deletedCount, retentionDays });
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup audit logs', { error: error.message, retentionDays });
      throw error;
    }
  }

  /**
   * Get security dashboard metrics
   */
  async getSecurityDashboard() {
    try {
      if (!supabase) {
        throw new Error('Database not available');
      }

      const { data, error } = await supabase
        .from('security_dashboard')
        .select('*')
        .order('metric');

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.error('Failed to get security dashboard', { error: error.message });
      throw error;
    }
  }

  // Helper methods for data masking
  _maskEmail(email) {
    if (!email) return null;
    const [local, domain] = email.split('@');
    if (!domain || local.length <= 2) return email;
    return `${local.substring(0, 2)}***@${domain}`;
  }

  _maskIP(ip) {
    if (!ip) return null;
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.xxx.xxx`;
    }
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

// Expose static constants on the instance for convenient access
auditService.ACTIONS = AuditService.ACTIONS;
auditService.RESOURCE_TYPES = AuditService.RESOURCE_TYPES;
auditService.SEVERITIES = AuditService.SEVERITIES;

module.exports = auditService;
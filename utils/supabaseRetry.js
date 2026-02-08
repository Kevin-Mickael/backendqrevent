/**
 * 🛡️ Supabase Retry Utility - QR Event
 * Handles network errors and retries for Supabase operations
 */

const logger = require('./logger');

/**
 * Retry wrapper for Supabase operations
 * @param {Function} operation - The Supabase operation to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {string} options.operationName - Name for logging purposes
 * @param {number} options.baseDelay - Base delay in ms (default: 1000)
 */
async function withRetry(operation, options = {}) {
  const {
    maxRetries = 3,
    operationName = 'database operation',
    baseDelay = 1000
  } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();

      // Handle Supabase response format
      if (result && typeof result === 'object' && 'error' in result) {
        const { data, error, status } = result;

        // User not found errors are expected, not retryable
        if (error && (error.code === 'PGRST116' || status === 404 || status === 406)) {
          return { data: null, error, status };
        }

        // Network/server errors are retryable
        if (error && attempt < maxRetries) {
          const isRetryable = (
            error.message.includes('fetch failed') ||
            error.message.includes('network') ||
            error.message.includes('timeout') ||
            status >= 500
          );

          if (isRetryable) {
            const delay = baseDelay * attempt; // exponential backoff
            logger.warn(`🔄 Retrying ${operationName} (${attempt}/${maxRetries})`, {
              error: error.message,
              delay: `${delay}ms`,
              attempt
            });
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        return result;
      }

      // Direct successful result
      return result;

    } catch (networkError) {
      if (attempt < maxRetries) {
        const isNetworkError = (
          networkError.message.includes('fetch failed') ||
          networkError.message.includes('network') ||
          networkError.message.includes('timeout') ||
          networkError.code === 'ECONNRESET' ||
          networkError.code === 'ENOTFOUND'
        );

        if (isNetworkError) {
          const delay = baseDelay * attempt;
          logger.warn(`🔄 Retrying ${operationName} after network error (${attempt}/${maxRetries})`, {
            error: networkError.message,
            code: networkError.code,
            delay: `${delay}ms`,
            attempt
          });
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // Non-retryable error or max retries reached
      throw networkError;
    }
  }

  throw new Error(`Max retries (${maxRetries}) exceeded for ${operationName}`);
}

/**
 * Check if an error is a network/temporary error
 */
function isRetryableError(error, status) {
  if (!error) return false;

  const retryablePatterns = [
    'fetch failed',
    'network',
    'timeout',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT'
  ];

  return (
    retryablePatterns.some(pattern => error.message.includes(pattern)) ||
    status >= 500
  );
}

/**
 * Simplified retry for common Supabase patterns
 */
function createRetryWrapper(operationName, maxRetries = 3) {
  return async function(operation) {
    return withRetry(operation, { operationName, maxRetries });
  };
}

module.exports = {
  withRetry,
  isRetryableError,
  createRetryWrapper
};
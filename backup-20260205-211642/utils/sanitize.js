/**
 * Utilitaires pour la sanitization des données sensibles
 */

// Champs sensibles à masquer dans les logs
const SENSITIVE_FIELDS = [
    'password',
    'password_hash',
    'token',
    'refresh_token',
    'session_token',
    'secret',
    'api_key',
    'apiKey',
    'credit_card',
    'creditCard',
    'ccv',
    'ssn',
    'social_security',
    'auth',
    'authorization',
    'cookie',
    'session'
];

/**
 * Masque les valeurs sensibles dans un objet
 * @param {Object} obj - L'objet à nettoyer
 * @param {number} maxDepth - Profondeur maximale de récursion
 * @param {number} currentDepth - Profondeur actuelle (usage interne)
 * @returns {Object} - L'objet nettoyé
 */
const sanitizeObject = (obj, maxDepth = 5, currentDepth = 0) => {
    // Limiter la profondeur pour éviter les problèmes de performance
    if (currentDepth >= maxDepth) {
        return '[MAX_DEPTH_REACHED]';
    }
    
    if (!obj || typeof obj !== 'object') {
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item, maxDepth, currentDepth + 1));
    }
    
    const sanitized = {};
    
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        
        // Vérifier si le champ est sensible
        if (SENSITIVE_FIELDS.some(sensitive => lowerKey.includes(sensitive))) {
            sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeObject(value, maxDepth, currentDepth + 1);
        } else {
            sanitized[key] = value;
        }
    }
    
    return sanitized;
};

/**
 * Masque les données sensibles dans une chaîne
 * @param {string} str - La chaîne à nettoyer
 * @returns {string} - La chaîne nettoyée
 */
const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    
    // Limiter la taille pour éviter les problèmes de mémoire
    const maxLength = 10000;
    if (str.length > maxLength) {
        return str.substring(0, maxLength) + '...[TRUNCATED]';
    }
    
    return str;
};

/**
 * Sanitize les données pour le logging
 * @param {Object} data - Les données à logger
 * @returns {Object} - Les données nettoyées
 */
const sanitizeForLogging = (data) => {
    if (!data) return data;
    
    if (typeof data === 'string') {
        return sanitizeString(data);
    }
    
    if (typeof data === 'object') {
        return sanitizeObject(data);
    }
    
    return data;
};

/**
 * Crée un objet de log sécurisé à partir d'une requête
 * @param {Object} req - L'objet requête Express
 * @returns {Object} - Les informations de log sécurisées
 */
const createSecureLogInfo = (req) => {
    return {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent')?.substring(0, 200), // Limiter la taille
        userId: req.user?.id || null,
        body: sanitizeForLogging(req.body),
        query: sanitizeForLogging(req.query)
    };
};

module.exports = {
    sanitizeObject,
    sanitizeString,
    sanitizeForLogging,
    createSecureLogInfo,
    SENSITIVE_FIELDS
};

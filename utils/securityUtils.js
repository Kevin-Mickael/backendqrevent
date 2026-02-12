/**
 * Utilitaires de sécurité pour l'application
 * Sanitisation, validation, et protection des données
 */

const logger = require('./logger');

// ============================================
// SANITISATION DES LOGS
// ============================================

const SENSITIVE_FIELDS = [
  'password', 'password_hash', 'token', 'refresh_token', 'secret',
  'credit_card', 'cvv', 'ssn', 'api_key', 'private_key',
  'session_token', 'access_token', 'authorization'
];

/**
 * Sanitise un objet pour le logging en masquant les champs sensibles
 * @param {Object} obj - Objet à sanitiser
 * @param {number} maxLength - Longueur maximale des strings
 * @returns {Object} - Objet sanitizé
 */
const sanitizeForLog = (obj, maxLength = 500) => {
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string' && obj.length > maxLength) {
      return obj.substring(0, maxLength) + '...[truncated]';
    }
    return obj;
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(obj)) {
    // Masquer les champs sensibles
    if (SENSITIVE_FIELDS.some(field => key.toLowerCase().includes(field))) {
      sanitized[key] = '[REDACTED]';
    }
    // Tronquer les strings trop longs
    else if (typeof value === 'string') {
      // Sanitiser les caractères spéciaux pour éviter les injections dans les logs
      const cleanValue = value
        .replace(/[<>\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Enlever les caractères de contrôle et <>
        .substring(0, maxLength);
      sanitized[key] = value.length > maxLength ? cleanValue + '...[truncated]' : cleanValue;
    }
    // Traiter les objets imbriqués (avec limite de profondeur)
    else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLog(value, maxLength);
    }
    else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

/**
 * Sanitise un nom de fichier pour éviter les injections
 * @param {string} filename - Nom de fichier à sanitiser
 * @returns {string} - Nom de fichier sanitizé
 */
const sanitizeFilename = (filename) => {
  if (!filename || typeof filename !== 'string') return 'unknown';

  // Enlever les caractères dangereux et les path traversal
  return filename
    .replace(/[<>"'|;&$\x00-\x1F]/g, '') // Caractères de contrôle et spéciaux
    .replace(/\.\./g, '') // Path traversal
    .replace(/^\/+/, '') // Pas de chemins absolus
    .substring(0, 255); // Limite de longueur
};

/**
 * Sanitise une entrée utilisateur simple (string)
 * @param {string} input - Entrée à sanitiser
 * @param {number} maxLength - Longueur maximale
 * @returns {string} - Entrée sanitizée
 */
const sanitizeString = (input, maxLength = 1000) => {
  if (!input || typeof input !== 'string') return '';

  return input
    .replace(/[<>]/g, '') // XSS basique
    .trim()
    .substring(0, maxLength);
};

// ============================================
// VALIDATION DES DONNÉES
// ============================================

/**
 * Valide et nettoie les champs d'un événement
 * @param {Object} data - Données brutes
 * @returns {Object} - Données nettoyées avec seulement les champs autorisés
 */
const sanitizeEventData = (data) => {
  const allowedFields = [
    'title', 'description', 'guest_count', 'date', 'location',
    'cover_image', 'banner_image', 'settings', 'is_active'
  ];

  const sanitized = {};

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      switch (field) {
        case 'title':
        case 'description':
          sanitized[field] = sanitizeString(data[field], 2000);
          break;
        case 'guest_count':
          // Valider que c'est un nombre entier entre 1 et 1000
          const guestCount = parseInt(data[field], 10);
          sanitized[field] = !isNaN(guestCount) && guestCount >= 1 && guestCount <= 1000
            ? guestCount
            : null;
          break;
        case 'date':
          // Valider que c'est une date valide
          const dateObj = new Date(data[field]);
          sanitized[field] = isNaN(dateObj.getTime()) ? null : data[field];
          break;
        case 'location':
          sanitized[field] = typeof data[field] === 'object'
            ? sanitizeLocationData(data[field])
            : null;
          break;
        case 'settings':
          sanitized[field] = typeof data[field] === 'object'
            ? sanitizeSettingsData(data[field])
            : {};
          break;
        case 'is_active':
          sanitized[field] = Boolean(data[field]);
          break;
        default:
          sanitized[field] = data[field];
      }
    }
  }

  return sanitized;
};

/**
 * Sanitise les données de localisation
 */
const sanitizeLocationData = (location) => {
  if (!location || typeof location !== 'object') return null;

  return {
    address: sanitizeString(location.address, 500),
    coordinates: location.coordinates && typeof location.coordinates === 'object'
      ? {
        lat: typeof location.coordinates.lat === 'number' ? location.coordinates.lat : null,
        lng: typeof location.coordinates.lng === 'number' ? location.coordinates.lng : null
      }
      : null
  };
};

/**
 * Sanitise les données de paramètres
 */
const sanitizeSettingsData = (settings) => {
  if (!settings || typeof settings !== 'object') return {};

  const allowedSettings = [
    'enableRSVP', 'enableGames', 'enablePhotoGallery',
    'enableGuestBook', 'enableQRVerification'
  ];

  const sanitized = {};
  for (const key of allowedSettings) {
    if (settings[key] !== undefined) {
      sanitized[key] = Boolean(settings[key]);
    }
  }

  return sanitized;
};

// ============================================
// PROTECTION CONTRE LES ATTAQUES
// ============================================

/**
 * Détecte si une chaîne contient du SQL injection potentiel
 * @param {string} input - Entrée à vérifier
 * @returns {boolean} - True si suspect
 */
const detectSQLInjection = (input) => {
  if (!input || typeof input !== 'string') return false;

  const sqlPatterns = [
    /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
    /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i,
    /\w*((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/i,
    /((\%27)|(\'))union/i,
    /exec(\s|\+)+(s|x)p\w+/i,
    /UNION\s+SELECT/i,
    /INSERT\s+INTO/i,
    /DELETE\s+FROM/i,
    /DROP\s+TABLE/i
  ];

  return sqlPatterns.some(pattern => pattern.test(input));
};

/**
 * Détecte si une chaîne contient du XSS potentiel
 * @param {string} input - Entrée à vérifier
 * @returns {boolean} - True si suspect
 */
const detectXSS = (input) => {
  if (!input || typeof input !== 'string') return false;

  const xssPatterns = [
    /<script[^>]*>[\s\S]*?<\/script>/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /eval\s*\(/i,
    /expression\s*\(/i
  ];

  return xssPatterns.some(pattern => pattern.test(input));
};

/**
 * Middleware pour détecter les activités suspectes
 */
const suspiciousActivityDetector = (req, res, next) => {
  const suspiciousHeaders = req.headers['x-http-method-override'] ||
    req.headers['http-method-override'];

  if (suspiciousHeaders) {
    logger.warn('🚨 Suspicious header detected', {
      ip: req.ip,
      header: suspiciousHeaders,
      path: req.path
    });
  }

  // Vérifier les tentatives de path traversal
  if (req.path.includes('..') || req.path.includes('%2e%2e')) {
    logger.warn('🚨 Path traversal attempt detected', {
      ip: req.ip,
      path: req.path
    });
    return res.status(400).json({ success: false, message: 'Invalid request' });
  }

  next();
};

module.exports = {
  sanitizeForLog,
  sanitizeFilename,
  sanitizeString,
  sanitizeEventData,
  detectSQLInjection,
  detectXSS,
  suspiciousActivityDetector,
  SENSITIVE_FIELDS
};

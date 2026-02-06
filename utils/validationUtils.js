/**
 * Utilitaires de validation pour les IDs, chemins et paramètres
 * Protection contre les injections et les manipulations malveillantes
 */

const logger = require('./logger');

// ============================================
// VALIDATION DES IDS
// ============================================

/**
 * Valide un ID d'événement (format UUID ou MongoDB ObjectId)
 * @param {string} id - ID à valider
 * @returns {boolean} - True si valide
 */
const isValidEventId = (id) => {
  if (!id || typeof id !== 'string') return false;
  
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  // MongoDB ObjectId: 24 caractères hexadécimaux
  const objectIdRegex = /^[0-9a-f]{24}$/i;
  
  // ID numérique simple (PostgreSQL)
  const numericRegex = /^\d+$/;
  
  return uuidRegex.test(id) || objectIdRegex.test(id) || numericRegex.test(id);
};

/**
 * Valide un ID utilisateur
 * @param {string} id - ID à valider
 * @returns {boolean} - True si valide
 */
const isValidUserId = (id) => {
  if (!id || typeof id !== 'string') return false;
  
  // UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{3}-[0-9a-f]{3}-[0-9a-f]{12}$/i;
  // Numérique
  const numericRegex = /^\d+$/;
  
  return uuidRegex.test(id) || numericRegex.test(id);
};

/**
 * Valide un ID de guest
 * @param {string} id - ID à valider
 * @returns {boolean} - True si valide
 */
const isValidGuestId = isValidEventId;

/**
 * Valide un QR code
 * @param {string} qrCode - QR code à valider
 * @returns {boolean} - True si valide
 */
const isValidQRCode = (qrCode) => {
  if (!qrCode || typeof qrCode !== 'string') return false;
  // Alphanumérique uniquement, 10-50 caractères
  const qrRegex = /^[a-zA-Z0-9]{10,50}$/;
  return qrRegex.test(qrCode);
};

// ============================================
// VALIDATION DES CHEMINS (PATH TRAVERSAL)
// ============================================

/**
 * Sanitise un chemin de dossier pour éviter le path traversal
 * @param {string} folder - Chemin à sanitiser
 * @returns {string|null} - Chemin sanitizé ou null si invalide
 */
const sanitizeFolderPath = (folder) => {
  if (!folder || typeof folder !== 'string') return null;
  
  // Supprimer les caractères dangereux
  let sanitized = folder
    .replace(/\\/g, '/') // Normaliser les séparateurs
    .replace(/\.\./g, '') // Supprimer les ../
    .replace(/^\/+/, '') // Supprimer les / au début
    .replace(/\/+/g, '/') // Éviter les doubles slashes
    .replace(/[<>:"|?*\x00-\x1F]/g, ''); // Caractères interdits
  
  // Vérifier qu'il ne reste pas de tentative de traversal
  if (sanitized.includes('..')) {
    logger.warn('🚫 Path traversal attempt detected in folder path', { folder });
    return null;
  }
  
  // Limiter la longueur
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200);
  }
  
  return sanitized;
};

/**
 * Construit un chemin sécurisé pour le stockage de fichiers
 * @param {string} basePath - Chemin de base
 * @param {string} eventId - ID d'événement (sera validé)
 * @param {string} subfolder - Sous-dossier optionnel
 * @returns {string|null} - Chemin sécurisé ou null
 */
const buildSecurePath = (basePath, eventId, subfolder = '') => {
  // Valider l'ID d'événement
  if (!isValidEventId(eventId)) {
    logger.warn('🚫 Invalid event ID in path construction', { eventId });
    return null;
  }
  
  // Sanitiser le sous-dossier
  const cleanSubfolder = subfolder ? sanitizeFolderPath(subfolder) : '';
  if (subfolder && !cleanSubfolder) {
    return null;
  }
  
  // Construire le chemin
  const parts = [basePath, eventId];
  if (cleanSubfolder) {
    parts.push(cleanSubfolder);
  }
  
  return parts.join('/');
};

// ============================================
// MIDDLEWARES DE VALIDATION
// ============================================

/**
 * Middleware pour valider l'ID d'événement dans les paramètres
 */
const validateEventIdParam = (req, res, next) => {
  const { eventId } = req.params;
  
  if (!eventId || !isValidEventId(eventId)) {
    logger.warn('🚫 Invalid event ID in request params', { 
      eventId, 
      ip: req.ip,
      path: req.path 
    });
    return res.status(400).json({
      success: false,
      message: 'Invalid event ID format'
    });
  }
  
  next();
};

/**
 * Middleware pour valider l'ID de guest dans les paramètres
 */
const validateGuestIdParam = (req, res, next) => {
  const { guestId } = req.params;
  
  if (!guestId || !isValidGuestId(guestId)) {
    logger.warn('🚫 Invalid guest ID in request params', { 
      guestId, 
      ip: req.ip,
      path: req.path 
    });
    return res.status(400).json({
      success: false,
      message: 'Invalid guest ID format'
    });
  }
  
  next();
};

/**
 * Middleware pour valider le QR code dans les paramètres
 */
const validateQRCodeParam = (req, res, next) => {
  const { qrCode } = req.params;
  
  if (!qrCode || !isValidQRCode(qrCode)) {
    logger.warn('🚫 Invalid QR code in request params', { 
      qrCode: qrCode?.substring(0, 20),
      ip: req.ip,
      path: req.path 
    });
    return res.status(400).json({
      success: false,
      message: 'Invalid QR code format'
    });
  }
  
  next();
};

// ============================================
// VALIDATION DES BODY PARAMS
// ============================================

/**
 * Valide et limite la taille des tableaux dans les requêtes
 * @param {Array} arr - Tableau à valider
 * @param {number} maxLength - Taille maximale
 * @returns {boolean} - True si valide
 */
const validateArrayLength = (arr, maxLength = 1000) => {
  if (!Array.isArray(arr)) return false;
  if (arr.length > maxLength) return false;
  return true;
};

/**
 * Valide une adresse email basique
 * @param {string} email - Email à valider
 * @returns {boolean} - True si valide
 */
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  // Regex simple mais efficace
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

/**
 * Valide un numéro de téléphone (format international)
 * @param {string} phone - Numéro à valider
 * @returns {boolean} - True si valide
 */
const isValidPhone = (phone) => {
  if (!phone || typeof phone !== 'string') return false;
  // Accepte les formats: +33123456789, 0123456789, +33 1 23 45 67 89
  const phoneRegex = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
  return phoneRegex.test(phone.replace(/\s/g, '')) && phone.length <= 20;
};

module.exports = {
  isValidEventId,
  isValidUserId,
  isValidGuestId,
  isValidQRCode,
  sanitizeFolderPath,
  buildSecurePath,
  validateEventIdParam,
  validateGuestIdParam,
  validateQRCodeParam,
  validateArrayLength,
  isValidEmail,
  isValidPhone
};

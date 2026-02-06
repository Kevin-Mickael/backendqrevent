/**
 * Utilitaires de sécurité pour la validation et sanitization des chemins
 * Prévient les attaques Path Traversal et Directory Traversal
 */

const path = require('path');

// Whitelist des dossiers autorisés pour l'upload
const ALLOWED_FOLDERS = ['uploads', 'avatars', 'events', 'banners', 'covers', 'videos', 'images', 'general'];

// Caractères et séquences dangereuses
const DANGEROUS_PATTERNS = [
    /\.\./,           // ..
    /~/,              // ~ (home directory)
    /%2e%2e/i,        // URL encoded ..
    /%2f/i,           // URL encoded /
    /\\x2e\\x2e/i,    // Hex encoded ..
    /<script/i,       // XSS attempts
    /javascript:/i,    // JS protocol
    /^\//,            // Absolute paths starting with /
    /^[a-z]:/i,       // Windows drive letters (C:, D:, etc.)
];

/**
 * Valide et sanitise un chemin de dossier pour prévenir Path Traversal
 * @param {string} userInput - Le chemin fourni par l'utilisateur
 * @param {string} defaultFolder - Dossier par défaut si invalide
 * @returns {string} - Le chemin sanitizé
 * @throws {Error} - Si le chemin est dangereux
 */
function sanitizeFolderPath(userInput, defaultFolder = 'uploads') {
    // Si pas d'input, retourner le défaut
    if (!userInput || typeof userInput !== 'string') {
        return defaultFolder;
    }

    // Trim et décoder les encodages URL
    let sanitized = userInput.trim();
    
    try {
        // Décoder les encodages multiples
        let previous;
        do {
            previous = sanitized;
            sanitized = decodeURIComponent(previous);
        } while (sanitized !== previous);
    } catch (e) {
        // Erreur de décodage = input malveillant
        throw new Error('Invalid path encoding');
    }

    // Normaliser le chemin
    sanitized = path.normalize(sanitized);

    // Vérifier les patterns dangereux
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(sanitized)) {
            throw new Error(`Path contains dangerous pattern: ${pattern}`);
        }
    }

    // Vérifier que le chemin ne commence pas par / (absolu)
    if (path.isAbsolute(sanitized)) {
        throw new Error('Absolute paths are not allowed');
    }

    // Vérifier que le premier segment est dans la whitelist
    const baseFolder = sanitized.split(/[\/\\]/)[0]; // Supporte / et \
    if (!ALLOWED_FOLDERS.includes(baseFolder)) {
        throw new Error(`Folder '${baseFolder}' is not in allowed list`);
    }

    // Retirer tout ce qui pourrait être interprété comme un saut de dossier
    sanitized = sanitized
        .replace(/\.\./g, '')  // Retirer tous les ..
        .replace(/^[\.\/\\]+/, '')  // Retirer les . et / au début
        .replace(/\/+/g, '/')  // Normaliser les slashes multiples
        .replace(/\\+/g, '/');  // Convertir backslash en slash

    // Vérification finale que le chemin est sécurisé
    const finalPath = path.normalize(sanitized);
    if (finalPath.includes('..') || path.isAbsolute(finalPath)) {
        throw new Error('Path validation failed');
    }

    return finalPath || defaultFolder;
}

/**
 * Valide un eventId pour éviter les injections dans les chemins
 * @param {string} eventId - L'ID d'événement à valider
 * @returns {string} - L'ID validé
 * @throws {Error} - Si l'ID est invalide
 */
function validateEventId(eventId) {
    if (!eventId || typeof eventId !== 'string') {
        throw new Error('Event ID is required');
    }

    // Les UUIDs ou IDs alphanumériques sont attendus
    // Rejeter tout caractère spécial ou path traversal
    const validEventIdRegex = /^[a-zA-Z0-9-_]+$/;
    
    if (!validEventIdRegex.test(eventId)) {
        throw new Error('Invalid event ID format');
    }

    // Vérifier les patterns de traversal
    if (eventId.includes('..') || eventId.includes('/') || eventId.includes('\\')) {
        throw new Error('Event ID contains invalid characters');
    }

    return eventId;
}

/**
 * Construit un chemin sécurisé pour le stockage de fichiers
 * @param {string} baseFolder - Dossier de base (validé)
 * @param {string} eventId - ID d'événement optionnel (validé)
 * @param {string} subFolder - Sous-dossier optionnel (validé)
 * @returns {string} - Chemin sécurisé
 */
function buildSecurePath(baseFolder, eventId = null, subFolder = null) {
    let securePath = sanitizeFolderPath(baseFolder, 'uploads');

    if (eventId) {
        const validEventId = validateEventId(eventId);
        securePath = path.join(securePath, 'events', validEventId);
    }

    if (subFolder) {
        const validSubFolder = sanitizeFolderPath(subFolder, 'general');
        // Retirer le premier segment car sanitizeFolderPath retourne un chemin complet
        const subFolderParts = validSubFolder.split('/').slice(1).join('/');
        if (subFolderParts) {
            securePath = path.join(securePath, subFolderParts);
        }
    }

    // Normaliser une dernière fois
    return securePath.replace(/\\/g, '/');
}

/**
 * Middleware Express pour valider les chemins d'upload
 */
function validateUploadPath(req, res, next) {
    try {
        const folder = req.body?.folder || req.query?.folder;
        const eventId = req.body?.eventId || req.params?.eventId;

        // Sanitiser et stocker dans req.securePath
        req.securePath = buildSecurePath(folder, eventId);
        
        next();
    } catch (error) {
        console.warn('[PathSecurity] Rejected dangerous path:', {
            folder: req.body?.folder || req.query?.folder,
            eventId: req.body?.eventId || req.params?.eventId,
            error: error.message,
            ip: req.ip
        });

        return res.status(400).json({
            success: false,
            message: 'Invalid folder path'
        });
    }
}

module.exports = {
    sanitizeFolderPath,
    validateEventId,
    buildSecurePath,
    validateUploadPath,
    ALLOWED_FOLDERS
};

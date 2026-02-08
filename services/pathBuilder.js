/**
 * Service de construction de chemins sécurisés pour Cloudflare R2
 * Architecture hiérarchique : users/{userId}/events/{eventId}/type/category/
 */

const { v4: uuidv4 } = require('uuid');
const path = require('path');

class PathBuilderService {
    /**
     * Construit un chemin sécurisé pour les uploads
     * @param {string} userId - ID de l'utilisateur 
     * @param {string} eventId - ID de l'événement (optionnel)
     * @param {string} type - Type de fichier (avatars, menus, banners, etc.)
     * @param {string} category - Catégorie spécifique (optionnel)
     * @returns {string} Chemin sécurisé
     */
    buildPath(userId, eventId = null, type, category = null) {
        if (!userId || !type) {
            throw new Error('userId et type sont requis');
        }

        const segments = ['users', userId];

        if (eventId) {
            segments.push('events', eventId);
        }

        segments.push(type);

        if (category) {
            segments.push(category);
        }

        return segments.join('/');
    }

    /**
     * Chemins spécialisés pour les différents types de fichiers
     */

    // Avatar utilisateur
    buildAvatarPath(userId) {
        return this.buildPath(userId, null, 'avatars');
    }

    // Bannière d'événement  
    buildBannerPath(userId, eventId) {
        return this.buildPath(userId, eventId, 'banners');
    }

    // Image de couverture d'événement
    buildCoverPath(userId, eventId) {
        return this.buildPath(userId, eventId, 'covers');
    }

    // Menus avec catégorisation
    buildMenuPath(userId, eventId, menuCategory = null) {
        const validCategories = [
            'appetizers',      // Entrées
            'main-courses',    // Plats principaux
            'desserts',        // Desserts
            'drinks',          // Boissons
            'wine-list',       // Carte des vins
            'full-menu',       // Menu complet
            'allergies',       // Informations allergies
            'vegetarian',      // Options végétariennes
            'special-diet'     // Régimes spéciaux
        ];

        // Si une catégorie est fournie, la valider
        if (menuCategory && !validCategories.includes(menuCategory)) {
            throw new Error(`Catégorie de menu invalide: ${menuCategory}. Catégories valides: ${validCategories.join(', ')}`);
        }

        return this.buildPath(userId, eventId, 'menus', menuCategory);
    }

    // Galerie d'événement
    buildGalleryPath(userId, eventId) {
        return this.buildPath(userId, eventId, 'gallery');
    }

    // QR codes
    buildQrCodePath(userId, eventId) {
        return this.buildPath(userId, eventId, 'qr-codes');
    }

    // Fichiers temporaires
    buildTempPath(userId) {
        return this.buildPath(userId, null, 'temp');
    }

    // Messages et pièces jointes
    buildMessagePath(userId, eventId) {
        return this.buildPath(userId, eventId, 'messages');
    }

    /**
     * Génère un nom de fichier unique avec préfixe
     * @param {string} originalName - Nom original du fichier
     * @param {string} prefix - Préfixe optionnel
     * @returns {string} Nom de fichier unique
     */
    generateUniqueFileName(originalName, prefix = '') {
        const ext = path.extname(originalName);
        const uniqueId = uuidv4();
        const timestamp = Date.now();
        
        if (prefix) {
            return `${prefix}_${timestamp}_${uniqueId}${ext}`;
        }
        
        return `${timestamp}_${uniqueId}${ext}`;
    }

    /**
     * Validation et nettoyage des paramètres
     * @param {string} userId 
     * @param {string} eventId 
     * @returns {object} Paramètres validés
     */
    validateParams(userId, eventId = null) {
        // Validation UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        
        if (!uuidRegex.test(userId)) {
            throw new Error('userId doit être un UUID valide');
        }

        if (eventId && !uuidRegex.test(eventId)) {
            throw new Error('eventId doit être un UUID valide');
        }

        return { userId, eventId };
    }

    /**
     * Parse un chemin R2 pour extraire les informations
     * @param {string} filePath - Chemin du fichier dans R2
     * @returns {object} Informations extraites
     */
    parsePath(filePath) {
        const segments = filePath.split('/');
        
        if (segments[0] !== 'users' || segments.length < 3) {
            throw new Error('Format de chemin invalide');
        }

        const result = {
            userId: segments[1],
            type: segments[segments.length - 2], // Avant-dernier segment
            fileName: segments[segments.length - 1]
        };

        // Si le chemin contient "events"
        if (segments[2] === 'events') {
            result.eventId = segments[3];
            result.type = segments[4];
            
            // Si il y a une catégorie
            if (segments.length > 6) {
                result.category = segments[5];
            }
        }

        return result;
    }

    /**
     * Génère des exemples de chemins pour documentation
     * @returns {object} Exemples de chemins
     */
    getExamples() {
        const userId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
        const eventId = 'e47ac10b-58cc-4372-a567-0e02b2c3d480';

        return {
            avatar: this.buildAvatarPath(userId),
            banner: this.buildBannerPath(userId, eventId),
            cover: this.buildCoverPath(userId, eventId),
            menuGeneral: this.buildMenuPath(userId, eventId),
            menuAppetizers: this.buildMenuPath(userId, eventId, 'appetizers'),
            menuWineList: this.buildMenuPath(userId, eventId, 'wine-list'),
            gallery: this.buildGalleryPath(userId, eventId),
            qrCodes: this.buildQrCodePath(userId, eventId),
            temp: this.buildTempPath(userId),
            messages: this.buildMessagePath(userId, eventId)
        };
    }
}

module.exports = new PathBuilderService();
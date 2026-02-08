/**
 * Exemple d'utilisation de l'upload structuré pour les menus
 * Montre comment organiser les fichiers de menu par catégorie
 */

const express = require('express');
const router = express.Router();
const uploadMenu = require('../middleware/uploadMenu');
const storageService = require('../services/storageService');
const authenticateToken = require('../middleware/auth');
const { celebrate, Joi, Segments } = require('celebrate');

// Validation des paramètres
const menuUploadValidation = celebrate({
    [Segments.PARAMS]: {
        eventId: Joi.string().uuid().required()
    },
    [Segments.BODY]: {
        category: Joi.string().valid(
            'appetizers',      // Entrées
            'main-courses',    // Plats principaux  
            'desserts',        // Desserts
            'drinks',          // Boissons
            'wine-list',       // Carte des vins
            'full-menu',       // Menu complet
            'allergies',       // Informations allergies
            'vegetarian',      // Options végétariennes
            'special-diet'     // Régimes spéciaux
        ).optional(),
        title: Joi.string().min(1).max(100).optional(),
        description: Joi.string().max(500).optional()
    }
});

/**
 * POST /api/events/:eventId/upload-menu-structured
 * Upload structuré d'un fichier de menu avec catégorisation
 */
router.post('/events/:eventId/upload-menu-structured', 
    authenticateToken, 
    menuUploadValidation,
    uploadMenu.single('menu_file'), 
    async (req, res) => {
        try {
            const { eventId } = req.params;
            const { category, title, description } = req.body;
            const userId = req.user.id;

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'Aucun fichier fourni'
                });
            }

            console.log('[Menu Upload Structured] Processing file:', {
                eventId,
                userId,
                category: category || 'general',
                originalName: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            });

            // Utiliser l'upload structuré
            const fileUrl = await storageService.uploadFileStructured(
                req.file,
                userId,
                eventId,
                'menus',
                category
            );

            // Optionnel : Sauvegarder les métadonnées en base
            const menuData = {
                event_id: eventId,
                user_id: userId,
                file_url: fileUrl,
                file_name: req.file.originalname,
                category: category || 'general',
                title: title || req.file.originalname,
                description: description || null,
                file_size: req.file.size,
                mime_type: req.file.mimetype,
                uploaded_at: new Date()
            };

            // Ici vous pourriez sauvegarder dans une table menu_files
            console.log('[Menu Upload] Menu data to save:', menuData);

            res.json({
                success: true,
                message: 'Menu uploadé avec succès',
                data: {
                    fileUrl,
                    fileName: req.file.originalname,
                    category: category || 'general',
                    title: title || req.file.originalname,
                    path: `users/${userId}/events/${eventId}/menus/${category || 'general'}`,
                    uploadedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('[Menu Upload Structured] Error:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'upload du menu',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

/**
 * GET /api/events/:eventId/menu-structure
 * Obtenir la structure des menus organisés par catégorie
 */
router.get('/events/:eventId/menu-structure', authenticateToken, async (req, res) => {
    try {
        const { eventId } = req.params;
        const userId = req.user.id;

        // Exemple de structure retournée (à adapter avec votre base de données)
        const menuStructure = {
            eventId,
            categories: {
                'appetizers': {
                    label: 'Entrées',
                    files: [
                        // Fichiers de cette catégorie
                    ]
                },
                'main-courses': {
                    label: 'Plats principaux',
                    files: []
                },
                'desserts': {
                    label: 'Desserts', 
                    files: []
                },
                'drinks': {
                    label: 'Boissons',
                    files: []
                },
                'wine-list': {
                    label: 'Carte des vins',
                    files: []
                },
                'full-menu': {
                    label: 'Menu complet',
                    files: []
                },
                'allergies': {
                    label: 'Informations allergies',
                    files: []
                },
                'vegetarian': {
                    label: 'Options végétariennes',
                    files: []
                },
                'special-diet': {
                    label: 'Régimes spéciaux',
                    files: []
                }
            },
            totalFiles: 0,
            lastUpdate: new Date().toISOString()
        };

        res.json({
            success: true,
            data: menuStructure
        });

    } catch (error) {
        console.error('[Menu Structure] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération de la structure des menus'
        });
    }
});

/**
 * GET /api/path-examples
 * Exemples de chemins générés pour documentation
 */
router.get('/path-examples', (req, res) => {
    try {
        const pathBuilder = require('../services/pathBuilder');
        const examples = pathBuilder.getExamples();

        res.json({
            success: true,
            message: 'Exemples de chemins R2 structurés',
            data: {
                description: 'Architecture: users/{userId}/events/{eventId}/{type}/{category}/',
                examples,
                categories: {
                    menus: [
                        'appetizers', 'main-courses', 'desserts', 'drinks',
                        'wine-list', 'full-menu', 'allergies', 'vegetarian', 'special-diet'
                    ],
                    others: [
                        'avatars', 'banners', 'covers', 'gallery', 
                        'qr-codes', 'messages', 'temp'
                    ]
                }
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la génération des exemples'
        });
    }
});

module.exports = router;
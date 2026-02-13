/**
 * Routes pour la gestion des invitation designs
 *
 * Un invitation design = un template/design d'invitation créé pour un événement
 * Chaque événement peut avoir plusieurs designs
 * Chaque design peut être assigné à des groupes de familles
 */

const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { supabaseService } = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// ============================================
// VALIDATION MIDDLEWARE
// ============================================

const validateInvitationDesign = [
    body('name')
        .trim()
        .notEmpty().withMessage('Le nom est requis')
        .isLength({ min: 3, max: 255 }).withMessage('Le nom doit contenir entre 3 et 255 caractères'),
    body('template')
        .trim()
        .notEmpty().withMessage('Le template est requis')
        .isLength({ max: 100 }).withMessage('Le template ne peut pas dépasser 100 caractères'),
    body('status')
        .optional()
        .isIn(['draft', 'published', 'completed']).withMessage('Statut invalide'),
    body('cover_image')
        .optional()
        .isURL().withMessage('L\'URL de l\'image de couverture est invalide'),
    body('custom_data')
        .optional()
        .isObject().withMessage('Les données personnalisées doivent être un objet JSON'),
];

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Erreur de validation',
            errors: errors.array()
        });
    }
    next();
};

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/events/:eventId/invitation-designs
 * Récupère tous les designs d'invitation pour un événement
 */
router.get(
    '/events/:eventId/invitation-designs',
    authenticateToken,
    [
        param('eventId').isUUID().withMessage('ID d\'événement invalide'),
        handleValidationErrors
    ],
    async (req, res) => {
        const { eventId } = req.params;
        const userId = req.user.id;

        try {
            // Vérifier que l'événement appartient à l'utilisateur
            const { data: event, error: eventError } = await supabaseService
                .from('events')
                .select('id')
                .eq('id', eventId)
                .eq('user_id', userId)
                .single();

            if (eventError || !event) {
                return res.status(404).json({
                    success: false,
                    message: 'Événement non trouvé'
                });
            }

            // Récupérer les designs avec les stats
            const { data: designs, error: designsError } = await supabaseService
                .from('invitation_designs')
                .select('*')
                .eq('event_id', eventId)
                .order('created_at', { ascending: false });

            if (designsError) {
                throw designsError;
            }

            logger.info(`Retrieved ${designs?.length || 0} invitation designs for event ${eventId}`);

            res.json({
                success: true,
                data: designs || [],
                count: designs?.length || 0
            });
        } catch (error) {
            logger.error('Error fetching invitation designs:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des designs'
            });
        }
    }
);

/**
 * POST /api/events/:eventId/invitation-designs
 * Crée un nouveau design d'invitation pour un événement
 */
router.post(
    '/events/:eventId/invitation-designs',
    authenticateToken,
    [
        param('eventId').isUUID().withMessage('ID d\'événement invalide'),
        ...validateInvitationDesign,
        handleValidationErrors
    ],
    async (req, res) => {
        const { eventId } = req.params;
        const userId = req.user.id;
        const { name, template, status = 'draft', cover_image, custom_data = {} } = req.body;

        try {
            // Vérifier que l'événement appartient à l'utilisateur
            const { data: event, error: eventError } = await supabaseService
                .from('events')
                .select('id')
                .eq('id', eventId)
                .eq('user_id', userId)
                .single();

            if (eventError || !event) {
                return res.status(404).json({
                    success: false,
                    message: 'Événement non trouvé'
                });
            }

            // Vérifier que le nom n'est pas déjà utilisé pour cet événement
            const { data: existingDesign } = await supabaseService
                .from('invitation_designs')
                .select('id')
                .eq('event_id', eventId)
                .eq('name', name)
                .maybeSingle();

            if (existingDesign) {
                return res.status(400).json({
                    success: false,
                    message: 'Un design avec ce nom existe déjà pour cet événement'
                });
            }

            // Créer le design
            const { data: design, error: createError } = await supabaseService
                .from('invitation_designs')
                .insert({
                    event_id: eventId,
                    user_id: userId,
                    name,
                    template,
                    status,
                    cover_image,
                    custom_data: custom_data || {}
                })
                .select()
                .single();

            if (createError) {
                throw createError;
            }

            logger.info(`Created invitation design ${design.id} for event ${eventId}`, {
                designId: design.id,
                name: design.name,
                template: design.template
            });

            res.status(201).json({
                success: true,
                message: 'Design d\'invitation créé avec succès',
                data: design
            });
        } catch (error) {
            logger.error('Error creating invitation design:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la création du design'
            });
        }
    }
);

/**
 * GET /api/invitation-designs/:designId
 * Récupère un design d'invitation spécifique
 */
router.get(
    '/invitation-designs/:designId',
    authenticateToken,
    [
        param('designId').isUUID().withMessage('ID de design invalide'),
        handleValidationErrors
    ],
    async (req, res) => {
        const { designId } = req.params;
        const userId = req.user.id;

        try {
            const { data: design, error } = await supabaseService
                .from('invitation_designs')
                .select('*, events!inner(user_id)')
                .eq('id', designId)
                .eq('events.user_id', userId)
                .single();

            if (error || !design) {
                return res.status(404).json({
                    success: false,
                    message: 'Design non trouvé'
                });
            }

            // Remove the nested events object
            const { events, ...designData } = design;

            res.json({
                success: true,
                data: designData
            });
        } catch (error) {
            logger.error('Error fetching invitation design:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération du design'
            });
        }
    }
);

/**
 * PUT /api/invitation-designs/:designId
 * Met à jour un design d'invitation
 */
router.put(
    '/invitation-designs/:designId',
    authenticateToken,
    [
        param('designId').isUUID().withMessage('ID de design invalide'),
        body('name').optional().trim().isLength({ min: 3, max: 255 }),
        body('template').optional().trim().isLength({ max: 100 }),
        body('status').optional().isIn(['draft', 'published', 'completed']),
        body('cover_image').optional().isURL(),
        body('custom_data').optional().isObject(),
        handleValidationErrors
    ],
    async (req, res) => {
        const { designId } = req.params;
        const userId = req.user.id;
        const updates = req.body;

        try {
            // Vérifier que le design appartient à l'utilisateur
            const { data: designCheck, error: checkError } = await supabaseService
                .from('invitation_designs')
                .select('id, event_id, events!inner(user_id)')
                .eq('id', designId)
                .eq('events.user_id', userId)
                .single();

            if (checkError || !designCheck) {
                return res.status(404).json({
                    success: false,
                    message: 'Design non trouvé'
                });
            }

            // Si le nom est modifié, vérifier qu'il n'est pas déjà utilisé
            if (updates.name) {
                const { data: existingDesign } = await supabaseService
                    .from('invitation_designs')
                    .select('id')
                    .eq('event_id', designCheck.event_id)
                    .eq('name', updates.name)
                    .neq('id', designId)
                    .maybeSingle();

                if (existingDesign) {
                    return res.status(400).json({
                        success: false,
                        message: 'Un design avec ce nom existe déjà pour cet événement'
                    });
                }
            }

            // Mettre à jour le design
            const { data: updatedDesign, error: updateError } = await supabaseService
                .from('invitation_designs')
                .update(updates)
                .eq('id', designId)
                .select()
                .single();

            if (updateError) {
                throw updateError;
            }

            logger.info(`Updated invitation design ${designId}`);

            res.json({
                success: true,
                message: 'Design mis à jour avec succès',
                data: updatedDesign
            });
        } catch (error) {
            logger.error('Error updating invitation design:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du design'
            });
        }
    }
);

/**
 * DELETE /api/invitation-designs/:designId
 * Supprime un design d'invitation
 */
router.delete(
    '/invitation-designs/:designId',
    authenticateToken,
    [
        param('designId').isUUID().withMessage('ID de design invalide'),
        handleValidationErrors
    ],
    async (req, res) => {
        const { designId } = req.params;
        const userId = req.user.id;

        try {
            // Vérifier que le design appartient à l'utilisateur et le supprimer
            const { data: design, error: checkError } = await supabaseService
                .from('invitation_designs')
                .select('id, events!inner(user_id)')
                .eq('id', designId)
                .eq('events.user_id', userId)
                .single();

            if (checkError || !design) {
                return res.status(404).json({
                    success: false,
                    message: 'Design non trouvé'
                });
            }

            // Supprimer le design
            const { error: deleteError } = await supabaseService
                .from('invitation_designs')
                .delete()
                .eq('id', designId);

            if (deleteError) {
                throw deleteError;
            }

            logger.info(`Deleted invitation design ${designId}`);

            res.json({
                success: true,
                message: 'Design supprimé avec succès'
            });
        } catch (error) {
            logger.error('Error deleting invitation design:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression du design'
            });
        }
    }
);

/**
 * PATCH /api/invitation-designs/:designId/increment-views
 * Incrémente le compteur de vues d'un design
 */
router.patch(
    '/invitation-designs/:designId/increment-views',
    [
        param('designId').isUUID().withMessage('ID de design invalide'),
        handleValidationErrors
    ],
    async (req, res) => {
        const { designId } = req.params;

        try {
            // Incrémenter le compteur
            const { error } = await supabaseService.rpc('increment', {
                table_name: 'invitation_designs',
                row_id: designId,
                column_name: 'views_count'
            });

            if (error) {
                // Fallback: utiliser une mise à jour standard
                await supabaseService
                    .from('invitation_designs')
                    .update({ views_count: supabaseService.raw('views_count + 1') })
                    .eq('id', designId);
            }

            res.json({
                success: true,
                message: 'Compteur de vues incrémenté'
            });
        } catch (error) {
            logger.error('Error incrementing views:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'incrémentation des vues'
            });
        }
    }
);

module.exports = router;

/**
 * Routes pour la gestion des assignations invitation-famille
 *
 * Permet d'assigner des designs d'invitation à des groupes de familles
 * Chaque famille peut être assignée à un design d'invitation spécifique
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
 * GET /api/events/:eventId/invitation-family-assignments
 * Récupère toutes les assignations pour un événement
 */
router.get(
    '/events/:eventId/invitation-family-assignments',
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

            // Récupérer toutes les assignations pour cet événement
            const { data: assignments, error: assignmentsError } = await supabaseService
                .from('invitation_family_assignments')
                .select('*')
                .eq('event_id', eventId)
                .order('assigned_at', { ascending: false });

            if (assignmentsError) {
                throw assignmentsError;
            }

            logger.info(`Retrieved ${assignments?.length || 0} invitation family assignments for event ${eventId}`);

            res.json({
                success: true,
                data: assignments || [],
                count: assignments?.length || 0
            });
        } catch (error) {
            logger.error('Error fetching invitation family assignments:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des assignations'
            });
        }
    }
);

/**
 * POST /api/events/:eventId/invitation-family-assignments
 * Crée une nouvelle assignation invitation-famille
 */
router.post(
    '/events/:eventId/invitation-family-assignments',
    authenticateToken,
    [
        param('eventId').isUUID().withMessage('ID d\'événement invalide'),
        body('invitation_id').isUUID().withMessage('ID d\'invitation invalide'),
        body('family_id').isUUID().withMessage('ID de famille invalide'),
        handleValidationErrors
    ],
    async (req, res) => {
        const { eventId } = req.params;
        const { invitation_id, family_id } = req.body;
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

            // Vérifier que le design d'invitation appartient à cet événement
            const { data: design, error: designError } = await supabaseService
                .from('invitation_designs')
                .select('id')
                .eq('id', invitation_id)
                .eq('event_id', eventId)
                .single();

            if (designError || !design) {
                return res.status(404).json({
                    success: false,
                    message: 'Design d\'invitation non trouvé pour cet événement'
                });
            }

            // Vérifier que la famille appartient à cet événement
            const { data: family, error: familyError } = await supabaseService
                .from('families')
                .select('id')
                .eq('id', family_id)
                .eq('event_id', eventId)
                .single();

            if (familyError || !family) {
                return res.status(404).json({
                    success: false,
                    message: 'Famille non trouvée pour cet événement'
                });
            }

            // Créer ou mettre à jour l'assignation (upsert)
            // Si la famille est déjà assignée à un autre design, on met à jour
            const { data: assignment, error: assignError } = await supabaseService
                .from('invitation_family_assignments')
                .upsert({
                    invitation_id,
                    family_id,
                    event_id: eventId,
                    assigned_by: userId,
                    assigned_at: new Date().toISOString()
                }, {
                    onConflict: 'event_id,family_id',
                    ignoreDuplicates: false
                })
                .select()
                .single();

            if (assignError) {
                throw assignError;
            }

            // Générer un QR code pour cette famille si elle n'en a pas déjà un
            const { data: existingQR } = await supabaseService
                .from('qr_codes')
                .select('id, code')
                .eq('family_id', family_id)
                .eq('event_id', eventId)
                .maybeSingle();

            let qrCode = existingQR?.code;

            if (!existingQR) {
                // Générer un nouveau code unique
                const crypto = require('crypto');
                qrCode = crypto.randomBytes(16).toString('hex');

                // Créer le QR code
                const { data: newQR, error: qrError } = await supabaseService
                    .from('qr_codes')
                    .insert({
                        code: qrCode,
                        family_id: family_id,
                        event_id: eventId,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (qrError) {
                    logger.error('Error creating QR code:', qrError);
                    // Continue anyway, QR code generation is not critical
                }
            }

            logger.info(`Created/updated invitation family assignment for event ${eventId}`, {
                assignmentId: assignment.id,
                invitationId: invitation_id,
                familyId: family_id,
                qrCode: qrCode
            });

            res.status(201).json({
                success: true,
                message: 'Assignation créée avec succès',
                data: {
                    ...assignment,
                    qr_code: qrCode,
                    invitation_url: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/i/${qrCode}`
                }
            });
        } catch (error) {
            logger.error('Error creating invitation family assignment:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la création de l\'assignation'
            });
        }
    }
);

/**
 * DELETE /api/invitation-family-assignments/:assignmentId
 * Supprime une assignation
 */
router.delete(
    '/invitation-family-assignments/:assignmentId',
    authenticateToken,
    [
        param('assignmentId').isUUID().withMessage('ID d\'assignation invalide'),
        handleValidationErrors
    ],
    async (req, res) => {
        const { assignmentId } = req.params;
        const userId = req.user.id;

        try {
            // Vérifier que l'assignation existe et appartient à l'utilisateur
            const { data: assignment, error: checkError } = await supabaseService
                .from('invitation_family_assignments')
                .select('id, event_id, events!inner(user_id)')
                .eq('id', assignmentId)
                .eq('events.user_id', userId)
                .single();

            if (checkError || !assignment) {
                return res.status(404).json({
                    success: false,
                    message: 'Assignation non trouvée'
                });
            }

            // Supprimer l'assignation
            const { error: deleteError } = await supabaseService
                .from('invitation_family_assignments')
                .delete()
                .eq('id', assignmentId);

            if (deleteError) {
                throw deleteError;
            }

            logger.info(`Deleted invitation family assignment ${assignmentId}`);

            res.json({
                success: true,
                message: 'Assignation supprimée avec succès'
            });
        } catch (error) {
            logger.error('Error deleting invitation family assignment:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression de l\'assignation'
            });
        }
    }
);

/**
 * POST /api/events/:eventId/invitation-family-assignments/batch
 * Crée plusieurs assignations en une seule requête
 */
router.post(
    '/events/:eventId/invitation-family-assignments/batch',
    authenticateToken,
    [
        param('eventId').isUUID().withMessage('ID d\'événement invalide'),
        body('assignments').isArray().withMessage('Les assignations doivent être un tableau'),
        body('assignments.*.invitation_id').isUUID().withMessage('ID d\'invitation invalide'),
        body('assignments.*.family_id').isUUID().withMessage('ID de famille invalide'),
        handleValidationErrors
    ],
    async (req, res) => {
        const { eventId } = req.params;
        const { assignments } = req.body;
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

            // Préparer les données pour l'insertion
            const assignmentsData = assignments.map(a => ({
                invitation_id: a.invitation_id,
                family_id: a.family_id,
                event_id: eventId,
                assigned_by: userId,
                assigned_at: new Date().toISOString()
            }));

            // Insérer en batch avec upsert
            const { data: createdAssignments, error: batchError } = await supabaseService
                .from('invitation_family_assignments')
                .upsert(assignmentsData, {
                    onConflict: 'event_id,family_id',
                    ignoreDuplicates: false
                })
                .select();

            if (batchError) {
                throw batchError;
            }

            logger.info(`Created/updated ${createdAssignments?.length || 0} invitation family assignments for event ${eventId}`);

            res.status(201).json({
                success: true,
                message: 'Assignations créées avec succès',
                data: createdAssignments,
                count: createdAssignments?.length || 0
            });
        } catch (error) {
            logger.error('Error creating batch invitation family assignments:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de la création des assignations'
            });
        }
    }
);

module.exports = router;

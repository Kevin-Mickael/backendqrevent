/**
 * Routes publiques pour les invitations (accessibles via QR code)
 *
 * Permet aux invités d'accéder à leur invitation personnalisée
 * et de soumettre leur RSVP sans authentification
 */

const express = require('express');
const router = express.Router();
const { param, body, validationResult } = require('express-validator');
const { supabaseService } = require('../config/supabase');
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
// ROUTES PUBLIQUES
// ============================================

/**
 * GET /api/invitations/public/:code
 * Récupère les données d'invitation via le QR code
 * Pas d'authentification requise
 */
router.get(
    '/invitations/public/:code',
    [
        param('code').trim().notEmpty().withMessage('Code invalide'),
        handleValidationErrors
    ],
    async (req, res) => {
        const { code } = req.params;

        try {
            // Chercher le QR code et récupérer les données liées
            const { data: qrCode, error: qrError } = await supabaseService
                .from('qr_codes')
                .select(`
                    id,
                    code,
                    family_id,
                    event_id,
                    scanned_at,
                    families!inner(
                        id,
                        family_name,
                        max_people
                    ),
                    events!inner(
                        id,
                        title,
                        bride_name,
                        groom_name,
                        date,
                        location,
                        banner_image,
                        cover_image
                    )
                `)
                .eq('code', code)
                .single();

            if (qrError || !qrCode) {
                return res.status(404).json({
                    success: false,
                    message: 'Code d\'invitation invalide ou expiré'
                });
            }

            // Trouver l'assignation invitation-famille pour cette famille
            const { data: assignment, error: assignmentError } = await supabaseService
                .from('invitation_family_assignments')
                .select(`
                    id,
                    invitation_id,
                    family_id,
                    event_id,
                    invitation_designs!inner(
                        id,
                        name,
                        template,
                        cover_image,
                        custom_data
                    )
                `)
                .eq('family_id', qrCode.family_id)
                .eq('event_id', qrCode.event_id)
                .maybeSingle();

            // Si pas d'assignation spécifique, utiliser un design par défaut
            let invitationDesign = null;
            if (assignment && assignment.invitation_designs) {
                invitationDesign = assignment.invitation_designs;
            } else {
                // Design par défaut si aucune assignation
                invitationDesign = {
                    id: null,
                    name: 'Invitation Classique',
                    template: 'default',
                    cover_image: null,
                    custom_data: {}
                };
            }

            // Récupérer le RSVP existant s'il y en a un
            const { data: rsvp } = await supabaseService
                .from('family_rsvp')
                .select('status, guests_count, message')
                .eq('family_id', qrCode.family_id)
                .eq('event_id', qrCode.event_id)
                .maybeSingle();

            // Mettre à jour la date de scan si première fois
            if (!qrCode.scanned_at) {
                await supabaseService
                    .from('qr_codes')
                    .update({ scanned_at: new Date().toISOString() })
                    .eq('id', qrCode.id);
            }

            // Incrémenter les vues du design si assigné
            if (assignment && assignment.invitation_id) {
                await supabaseService
                    .from('invitation_designs')
                    .update({ views_count: supabaseService.raw('views_count + 1') })
                    .eq('id', assignment.invitation_id);
            }

            logger.info(`Public invitation viewed via code ${code}`, {
                familyId: qrCode.family_id,
                eventId: qrCode.event_id,
                hasAssignment: !!assignment
            });

            res.json({
                success: true,
                data: {
                    id: qrCode.id,
                    family_id: qrCode.family_id,
                    family_name: qrCode.families.family_name,
                    max_people: qrCode.families.max_people,
                    event: {
                        id: qrCode.events.id,
                        title: qrCode.events.title,
                        bride_name: qrCode.events.bride_name,
                        groom_name: qrCode.events.groom_name,
                        date: qrCode.events.date,
                        location: qrCode.events.location,
                        banner_image: qrCode.events.banner_image,
                        cover_image: qrCode.events.cover_image
                    },
                    invitation_design: invitationDesign,
                    rsvp: rsvp || null
                }
            });
        } catch (error) {
            logger.error('Error fetching public invitation:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors du chargement de l\'invitation'
            });
        }
    }
);

/**
 * POST /api/invitations/public/:code/rsvp
 * Soumet le RSVP pour une invitation
 * Pas d'authentification requise
 */
router.post(
    '/invitations/public/:code/rsvp',
    [
        param('code').trim().notEmpty().withMessage('Code invalide'),
        body('status')
            .isIn(['accepted', 'declined', 'pending'])
            .withMessage('Statut invalide'),
        body('guests_count')
            .optional()
            .isInt({ min: 1, max: 20 })
            .withMessage('Nombre d\'invités invalide'),
        body('message')
            .optional()
            .trim()
            .isLength({ max: 500 })
            .withMessage('Message trop long (max 500 caractères)'),
        handleValidationErrors
    ],
    async (req, res) => {
        const { code } = req.params;
        const { status, guests_count, message } = req.body;

        try {
            // Vérifier que le code existe et récupérer les IDs
            const { data: qrCode, error: qrError } = await supabaseService
                .from('qr_codes')
                .select('id, family_id, event_id')
                .eq('code', code)
                .single();

            if (qrError || !qrCode) {
                return res.status(404).json({
                    success: false,
                    message: 'Code d\'invitation invalide'
                });
            }

            // Créer ou mettre à jour le RSVP
            const { data: rsvp, error: rsvpError } = await supabaseService
                .from('family_rsvp')
                .upsert({
                    family_id: qrCode.family_id,
                    event_id: qrCode.event_id,
                    status,
                    guests_count: status === 'accepted' ? (guests_count || 1) : 0,
                    message: message?.trim() || null,
                    response_date: new Date().toISOString()
                }, {
                    onConflict: 'family_id,event_id',
                    ignoreDuplicates: false
                })
                .select()
                .single();

            if (rsvpError) {
                throw rsvpError;
            }

            // Mettre à jour le compteur de réponses sur le design d'invitation
            const { data: assignment } = await supabaseService
                .from('invitation_family_assignments')
                .select('invitation_id')
                .eq('family_id', qrCode.family_id)
                .eq('event_id', qrCode.event_id)
                .maybeSingle();

            if (assignment && assignment.invitation_id) {
                await supabaseService
                    .from('invitation_designs')
                    .update({ responses_count: supabaseService.raw('responses_count + 1') })
                    .eq('id', assignment.invitation_id);
            }

            logger.info(`RSVP submitted via code ${code}`, {
                familyId: qrCode.family_id,
                eventId: qrCode.event_id,
                status,
                guestsCount: guests_count
            });

            res.json({
                success: true,
                message: 'Votre réponse a été enregistrée avec succès',
                data: rsvp
            });
        } catch (error) {
            logger.error('Error submitting RSVP:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'enregistrement de votre réponse'
            });
        }
    }
);

module.exports = router;

/**
 * Routes API pour la gestion du budget et des dépenses
 * Permet de gérer les devis, suivre les paiements et exporter les données
 */

const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { sanitizeInput } = require('../utils/sanitize');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

// Initialiser le client Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Schémas de validation
const budgetItemValidationSchema = {
    create: celebrate({
        [Segments.BODY]: Joi.object().keys({
            event_id: Joi.string().uuid().required(),
            title: Joi.string().required().max(200),
            description: Joi.string().max(1000).optional(),
            category: Joi.string().valid(
                'venue', 'catering', 'photography', 'music', 'flowers',
                'attire', 'transport', 'accommodation', 'invitations',
                'jewelry', 'beauty', 'wedding_party', 'gifts', 'other'
            ).default('other'),
            estimated_amount: Joi.number().min(0).required(),
            actual_amount: Joi.number().min(0).default(0),
            paid_amount: Joi.number().min(0).default(0),
            vendor_name: Joi.string().max(200).optional(),
            vendor_contact: Joi.string().max(255).optional(),
            vendor_email: Joi.string().email().max(255).optional(),
            vendor_phone: Joi.string().max(50).optional(),
            payment_status: Joi.string().valid('pending', 'partial', 'paid', 'cancelled').default('pending'),
            due_date: Joi.date().optional(),
            payment_date: Joi.date().optional(),
            notes: Joi.string().max(2000).optional(),
            attachment_url: Joi.string().uri().optional(),
            is_essential: Joi.boolean().default(false),
            is_paid_by_partner1: Joi.boolean().default(true),
            is_paid_by_partner2: Joi.boolean().default(false),
            quantity: Joi.number().integer().min(1).default(1),
            unit_price: Joi.number().min(0).default(0)
        })
    }),

    update: celebrate({
        [Segments.PARAMS]: Joi.object().keys({
            itemId: Joi.string().uuid().required()
        }),
        [Segments.BODY]: Joi.object().keys({
            title: Joi.string().max(200).optional(),
            description: Joi.string().max(1000).optional(),
            category: Joi.string().valid(
                'venue', 'catering', 'photography', 'music', 'flowers',
                'attire', 'transport', 'accommodation', 'invitations',
                'jewelry', 'beauty', 'wedding_party', 'gifts', 'other'
            ).optional(),
            estimated_amount: Joi.number().min(0).optional(),
            actual_amount: Joi.number().min(0).optional(),
            paid_amount: Joi.number().min(0).optional(),
            vendor_name: Joi.string().max(200).optional().allow(null, ''),
            vendor_contact: Joi.string().max(255).optional().allow(null, ''),
            vendor_email: Joi.string().email().max(255).optional().allow(null, ''),
            vendor_phone: Joi.string().max(50).optional().allow(null, ''),
            payment_status: Joi.string().valid('pending', 'partial', 'paid', 'cancelled').optional(),
            due_date: Joi.date().optional().allow(null),
            payment_date: Joi.date().optional().allow(null),
            notes: Joi.string().max(2000).optional().allow(null, ''),
            attachment_url: Joi.string().uri().optional().allow(null, ''),
            is_essential: Joi.boolean().optional(),
            is_paid_by_partner1: Joi.boolean().optional(),
            is_paid_by_partner2: Joi.boolean().optional(),
            quantity: Joi.number().integer().min(1).optional(),
            unit_price: Joi.number().min(0).optional()
        })
    }),

    getByEvent: celebrate({
        [Segments.PARAMS]: Joi.object().keys({
            eventId: Joi.string().uuid().required()
        })
    })
};

// Catégories avec leurs labels pour l'export
const categoryLabels = {
    venue: 'Lieu de réception',
    catering: 'Traiteur',
    photography: 'Photo/Vidéo',
    music: 'Musique/DJ',
    flowers: 'Fleurs/Décoration',
    attire: 'Tenue/Mariage',
    transport: 'Transport',
    accommodation: 'Hébergement',
    invitations: 'Faire-part',
    jewelry: 'Bijoux/Alliances',
    beauty: 'Coiffure/Maquillage',
    wedding_party: 'EVG/EVJF',
    gifts: 'Cadeaux invités',
    other: 'Autre'
};

const paymentStatusLabels = {
    pending: 'En attente',
    partial: 'Partiel',
    paid: 'Payé',
    cancelled: 'Annulé'
};

/**
 * @route GET /api/budget/items
 * @desc Récupérer tous les items budget de l'utilisateur
 * @access Private
 */
router.get('/items', authenticateToken, generalLimiter, async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: items, error } = await supabase
            .from('budget_items')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            logger.error('Error fetching budget items:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des dépenses'
            });
        }

        res.json({
            success: true,
            data: items,
            count: items.length
        });
    } catch (error) {
        logger.error('Get budget items error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * @route GET /api/budget/event/:eventId
 * @desc Récupérer les items budget pour un événement spécifique
 * @access Private
 */
router.get('/event/:eventId',
    authenticateToken,
    generalLimiter,
    budgetItemValidationSchema.getByEvent,
    async (req, res) => {
        try {
            const userId = req.user.id;
            const { eventId } = req.params;

            // Vérifier que l'utilisateur a accès à cet événement (organizer_id OU user_id)
            const { data: event, error: eventError } = await supabase
                .from('events')
                .select('id')
                .eq('id', eventId)
                .or(`organizer_id.eq.${userId},user_id.eq.${userId}`)
                .single();

            if (eventError || !event) {
                console.warn('[Budget] Access denied - Event not found or user not organizer:', {
                    eventId,
                    userId,
                    error: eventError?.message
                });
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé à cet événement'
                });
            }

            const { data: items, error } = await supabase
                .from('budget_items')
                .select('*')
                .eq('event_id', eventId)
                .order('created_at', { ascending: false });

            if (error) {
                logger.error('Error fetching budget items by event:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la récupération des dépenses'
                });
            }

            // Calculer les statistiques
            const stats = items.reduce((acc, item) => {
                acc.totalEstimated += parseFloat(item.estimated_amount) || 0;
                acc.totalActual += parseFloat(item.actual_amount) || 0;
                acc.totalPaid += parseFloat(item.paid_amount) || 0;
                acc.totalPending += (parseFloat(item.actual_amount) || 0) - (parseFloat(item.paid_amount) || 0);

                if (item.payment_status === 'paid') acc.countPaid++;
                else if (item.payment_status === 'partial') acc.countPartial++;
                else if (item.payment_status === 'pending') acc.countPending++;

                return acc;
            }, {
                totalEstimated: 0,
                totalActual: 0,
                totalPaid: 0,
                totalPending: 0,
                countPaid: 0,
                countPartial: 0,
                countPending: 0
            });

            res.json({
                success: true,
                data: items,
                stats,
                count: items.length
            });
        } catch (error) {
            logger.error('Get budget items by event error:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }
    }
);

/**
 * @route POST /api/budget/items
 * @desc Créer un nouvel item budget
 * @access Private
 */
router.post('/items',
    authenticateToken,
    generalLimiter,
    budgetItemValidationSchema.create,
    async (req, res) => {
        try {
            const userId = req.user.id;
            const {
                event_id,
                title,
                description,
                category,
                estimated_amount,
                actual_amount,
                paid_amount,
                vendor_name,
                vendor_contact,
                vendor_email,
                vendor_phone,
                payment_status,
                due_date,
                payment_date,
                notes,
                attachment_url,
                is_essential,
                is_paid_by_partner1,
                is_paid_by_partner2,
                quantity,
                unit_price
            } = req.body;

            // Vérifier que l'utilisateur a accès à cet événement (organizer_id OU user_id)
            const { data: event, error: eventError } = await supabase
                .from('events')
                .select('id')
                .eq('id', event_id)
                .or(`organizer_id.eq.${userId},user_id.eq.${userId}`)
                .single();

            if (eventError || !event) {
                console.warn('[Budget] Create access denied - Event not found or user not organizer:', {
                    eventId: event_id,
                    userId,
                    error: eventError?.message
                });
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé à cet événement'
                });
            }

            const { data: item, error } = await supabase
                .from('budget_items')
                .insert({
                    event_id,
                    user_id: userId,
                    title: sanitizeInput(title),
                    description: sanitizeInput(description),
                    category,
                    estimated_amount,
                    actual_amount,
                    paid_amount,
                    vendor_name: sanitizeInput(vendor_name),
                    vendor_contact: sanitizeInput(vendor_contact),
                    vendor_email: vendor_email ? sanitizeInput(vendor_email) : null,
                    vendor_phone: sanitizeInput(vendor_phone),
                    payment_status,
                    due_date,
                    payment_date,
                    notes: sanitizeInput(notes),
                    attachment_url,
                    is_essential,
                    is_paid_by_partner1,
                    is_paid_by_partner2,
                    quantity: quantity || 1,
                    unit_price: unit_price || 0
                })
                .select()
                .single();

            if (error) {
                logger.error('Error creating budget item:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la création de la dépense'
                });
            }

            logger.info(`Budget item created: ${item.id} by user ${userId}`);

            res.status(201).json({
                success: true,
                data: item,
                message: 'Dépense créée avec succès'
            });
        } catch (error) {
            logger.error('Create budget item error:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }
    }
);

/**
 * @route PUT /api/budget/items/:itemId
 * @desc Mettre à jour un item budget
 * @access Private
 */
router.put('/items/:itemId',
    authenticateToken,
    generalLimiter,
    budgetItemValidationSchema.update,
    async (req, res) => {
        try {
            const userId = req.user.id;
            const { itemId } = req.params;
            const updateData = req.body;

            // Vérifier que l'item appartient à l'utilisateur
            const { data: existingItem, error: checkError } = await supabase
                .from('budget_items')
                .select('id')
                .eq('id', itemId)
                .eq('user_id', userId)
                .single();

            if (checkError || !existingItem) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé à cette dépense'
                });
            }

            // Sanitizer les champs texte
            const sanitizedData = {};
            const textFields = ['title', 'description', 'vendor_name', 'vendor_contact', 'vendor_email', 'vendor_phone', 'notes'];

            for (const [key, value] of Object.entries(updateData)) {
                if (textFields.includes(key) && value !== undefined) {
                    sanitizedData[key] = sanitizeInput(value);
                } else {
                    sanitizedData[key] = value;
                }
            }

            const { data: item, error } = await supabase
                .from('budget_items')
                .update(sanitizedData)
                .eq('id', itemId)
                .eq('user_id', userId)
                .select()
                .single();

            if (error) {
                logger.error('Error updating budget item:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Erreur lors de la mise à jour de la dépense'
                });
            }

            logger.info(`Budget item updated: ${itemId} by user ${userId}`);

            res.json({
                success: true,
                data: item,
                message: 'Dépense mise à jour avec succès'
            });
        } catch (error) {
            logger.error('Update budget item error:', error);
            res.status(500).json({
                success: false,
                message: 'Erreur serveur'
            });
        }
    }
);

/**
 * @route DELETE /api/budget/items/:itemId
 * @desc Supprimer un item budget
 * @access Private
 */
router.delete('/items/:itemId', authenticateToken, generalLimiter, async (req, res) => {
    try {
        const userId = req.user.id;
        const { itemId } = req.params;

        // Vérifier que l'item appartient à l'utilisateur
        const { data: existingItem, error: checkError } = await supabase
            .from('budget_items')
            .select('id')
            .eq('id', itemId)
            .eq('user_id', userId)
            .single();

        if (checkError || !existingItem) {
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé à cette dépense'
            });
        }

        const { error } = await supabase
            .from('budget_items')
            .delete()
            .eq('id', itemId)
            .eq('user_id', userId);

        if (error) {
            logger.error('Error deleting budget item:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression de la dépense'
            });
        }

        logger.info(`Budget item deleted: ${itemId} by user ${userId}`);

        res.json({
            success: true,
            message: 'Dépense supprimée avec succès'
        });
    } catch (error) {
        logger.error('Delete budget item error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * @route GET /api/budget/stats/:eventId
 * @desc Récupérer les statistiques détaillées du budget
 * @access Private
 */
router.get('/stats/:eventId', authenticateToken, generalLimiter, async (req, res) => {
    try {
        const userId = req.user.id;
        const { eventId } = req.params;

        // Vérifier l'accès à l'événement (organizer_id OU user_id)
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('id, total_budget')
            .eq('id', eventId)
            .or(`organizer_id.eq.${userId},user_id.eq.${userId}`)
            .single();

        if (eventError || !event) {
            console.warn('[Budget] Stats access denied - Event not found or user not organizer:', {
                eventId,
                userId,
                error: eventError?.message
            });
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé à cet événement'
            });
        }

        const { data: items, error } = await supabase
            .from('budget_items')
            .select('*')
            .eq('event_id', eventId);

        if (error) {
            logger.error('Error fetching budget stats:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des statistiques'
            });
        }

        // Statistiques globales
        const globalStats = items.reduce((acc, item) => {
            acc.totalEstimated += parseFloat(item.estimated_amount) || 0;
            acc.totalActual += parseFloat(item.actual_amount) || 0;
            acc.totalPaid += parseFloat(item.paid_amount) || 0;

            if (item.is_essential) {
                acc.essentialEstimated += parseFloat(item.estimated_amount) || 0;
                acc.essentialActual += parseFloat(item.actual_amount) || 0;
            }

            return acc;
        }, {
            totalEstimated: 0,
            totalActual: 0,
            totalPaid: 0,
            totalRemaining: 0,
            essentialEstimated: 0,
            essentialActual: 0,
            totalBudget: parseFloat(event.total_budget) || 0
        });

        globalStats.totalRemaining = globalStats.totalActual - globalStats.totalPaid;

        // Statistiques par catégorie
        const categoryStats = {};
        Object.keys(categoryLabels).forEach(cat => {
            categoryStats[cat] = {
                label: categoryLabels[cat],
                count: 0,
                estimated: 0,
                actual: 0,
                paid: 0
            };
        });

        items.forEach(item => {
            const cat = item.category || 'other';
            if (categoryStats[cat]) {
                categoryStats[cat].count++;
                categoryStats[cat].estimated += parseFloat(item.estimated_amount) || 0;
                categoryStats[cat].actual += parseFloat(item.actual_amount) || 0;
                categoryStats[cat].paid += parseFloat(item.paid_amount) || 0;
            }
        });

        // Statistiques par statut de paiement
        const paymentStats = {
            pending: { count: 0, amount: 0 },
            partial: { count: 0, amount: 0 },
            paid: { count: 0, amount: 0 },
            cancelled: { count: 0, amount: 0 }
        };

        items.forEach(item => {
            const status = item.payment_status || 'pending';
            if (paymentStats[status]) {
                paymentStats[status].count++;
                paymentStats[status].amount += parseFloat(item.actual_amount) || 0;
            }
        });

        res.json({
            success: true,
            data: {
                global: globalStats,
                byCategory: categoryStats,
                byPaymentStatus: paymentStats,
                itemCount: items.length
            }
        });
    } catch (error) {
        logger.error('Get budget stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * @route PUT /api/budget/event/:eventId/total
 * @desc Mettre à jour le budget total de l'événement
 * @access Private
 */
router.put('/event/:eventId/total', authenticateToken, generalLimiter, async (req, res) => {
    try {
        const userId = req.user.id;
        const { eventId } = req.params;
        const { total_budget } = req.body;

        if (total_budget === undefined || total_budget < 0) {
            return res.status(400).json({
                success: false,
                message: 'Budget total invalide'
            });
        }

        const { data: event, error } = await supabase
            .from('events')
            .update({ total_budget })
            .eq('id', eventId)
            .or(`organizer_id.eq.${userId},user_id.eq.${userId}`)
            .select()
            .single();

        if (error || !event) {
            logger.error('Error updating total budget:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du budget'
            });
        }

        res.json({
            success: true,
            data: event,
            message: 'Budget total mis à jour'
        });
    } catch (error) {
        logger.error('Update total budget error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * @route GET /api/budget/export/:eventId
 * @desc Exporter le budget au format JSON (pour PDF/Excel côté client)
 * @access Private
 */
router.get('/export/:eventId', authenticateToken, generalLimiter, async (req, res) => {
    try {
        const userId = req.user.id;
        const { eventId } = req.params;
        const { format = 'json' } = req.query;

        // Vérifier l'accès à l'événement (organizer_id OU user_id)
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('id, title, date')
            .eq('id', eventId)
            .or(`organizer_id.eq.${userId},user_id.eq.${userId}`)
            .single();

        if (eventError || !event) {
            console.warn('[Budget] Export access denied - Event not found or user not organizer:', {
                eventId,
                userId,
                error: eventError?.message
            });
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé à cet événement'
            });
        }

        const { data: items, error } = await supabase
            .from('budget_items')
            .select('*')
            .eq('event_id', eventId)
            .order('category', { ascending: true });

        if (error) {
            logger.error('Error exporting budget:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'export du budget'
            });
        }

        // Formater les données pour l'export
        const exportData = items.map(item => ({
            ...item,
            category_label: categoryLabels[item.category] || 'Autre',
            payment_status_label: paymentStatusLabels[item.payment_status] || 'En attente',
            remaining_amount: (parseFloat(item.actual_amount) || 0) - (parseFloat(item.paid_amount) || 0)
        }));

        // Calculer les totaux
        const totals = exportData.reduce((acc, item) => {
            acc.estimated += item.estimated_amount;
            acc.actual += item.actual_amount;
            acc.paid += item.paid_amount;
            acc.remaining += item.remaining_amount;
            return acc;
        }, { estimated: 0, actual: 0, paid: 0, remaining: 0 });

        const result = {
            event: {
                id: event.id,
                title: event.title,
                date: event.date
            },
            exportDate: new Date().toISOString(),
            items: exportData,
            totals,
            summary: {
                totalItems: items.length,
                paidItems: items.filter(i => i.payment_status === 'paid').length,
                pendingItems: items.filter(i => i.payment_status === 'pending').length,
                partialItems: items.filter(i => i.payment_status === 'partial').length
            }
        };

        // Si format CSV, convertir
        if (format === 'csv') {
            const headers = [
                'Titre', 'Catégorie', 'Fournisseur', 'Montant Estimé',
                'Montant Final', 'Payé', 'Reste', 'Statut', 'Date d\'échéance', 'Notes'
            ].join(';');

            const rows = exportData.map(item => [
                `"${item.title}"`,
                `"${item.category_label}"`,
                `"${item.vendor_name || ''}"`,
                item.estimated_amount,
                item.actual_amount,
                item.paid_amount,
                item.remaining_amount,
                `"${item.payment_status_label}"`,
                item.due_date || '',
                `"${(item.notes || '').replace(/"/g, '""')}"`
            ].join(';'));

            const csv = [headers, ...rows].join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="budget-${eventId}.csv"`);
            return res.send(csv);
        }

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error('Export budget error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * @route GET /api/budget/items/:itemId/details
 * @desc Récupérer les détails d'un item budget
 * @access Private
 */
router.get('/items/:itemId/details', authenticateToken, generalLimiter, async (req, res) => {
    try {
        const userId = req.user.id;
        const { itemId } = req.params;

        // Vérifier que l'item appartient à l'utilisateur
        const { data: item, error: itemError } = await supabase
            .from('budget_items')
            .select('id')
            .eq('id', itemId)
            .eq('user_id', userId)
            .single();

        if (itemError || !item) {
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé à cette dépense'
            });
        }

        const { data: details, error } = await supabase
            .from('budget_item_details')
            .select('*')
            .eq('budget_item_id', itemId)
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

        if (error) {
            logger.error('Error fetching budget item details:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des détails'
            });
        }

        res.json({
            success: true,
            data: details || []
        });
    } catch (error) {
        logger.error('Get budget item details error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * @route POST /api/budget/items/:itemId/details
 * @desc Créer un nouveau détail pour un item budget
 * @access Private
 */
router.post('/items/:itemId/details', authenticateToken, generalLimiter, async (req, res) => {
    try {
        const userId = req.user.id;
        const { itemId } = req.params;
        const { location, price, notes, sort_order } = req.body;

        // Vérifier que l'item appartient à l'utilisateur
        const { data: item, error: itemError } = await supabase
            .from('budget_items')
            .select('id, actual_amount')
            .eq('id', itemId)
            .eq('user_id', userId)
            .single();

        if (itemError || !item) {
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé à cette dépense'
            });
        }

        // Créer le détail
        const { data: detail, error } = await supabase
            .from('budget_item_details')
            .insert({
                budget_item_id: itemId,
                location: sanitizeInput(location),
                price: parseFloat(price) || 0,
                notes: sanitizeInput(notes),
                sort_order: sort_order || 0,
                is_active: true
            })
            .select()
            .single();

        if (error) {
            logger.error('Error creating budget item detail:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création du détail'
            });
        }

        // Mettre à jour le montant actual_amount de l'item budget
        const { data: allDetails } = await supabase
            .from('budget_item_details')
            .select('price')
            .eq('budget_item_id', itemId)
            .eq('is_active', true);

        const totalDetailsPrice = (allDetails || []).reduce((sum, d) => sum + (parseFloat(d.price) || 0), 0);

        await supabase
            .from('budget_items')
            .update({ actual_amount: totalDetailsPrice })
            .eq('id', itemId);

        logger.info(`Budget item detail created: ${detail.id} for item ${itemId} by user ${userId}`);

        res.status(201).json({
            success: true,
            data: detail,
            message: 'Détail ajouté avec succès'
        });
    } catch (error) {
        logger.error('Create budget item detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * @route PUT /api/budget/items/:itemId/details/:detailId
 * @desc Mettre à jour un détail d'item budget
 * @access Private
 */
router.put('/items/:itemId/details/:detailId', authenticateToken, generalLimiter, async (req, res) => {
    try {
        const userId = req.user.id;
        const { itemId, detailId } = req.params;
        const { location, price, notes, sort_order, is_active } = req.body;

        // Vérifier que l'item appartient à l'utilisateur
        const { data: item, error: itemError } = await supabase
            .from('budget_items')
            .select('id')
            .eq('id', itemId)
            .eq('user_id', userId)
            .single();

        if (itemError || !item) {
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé à cette dépense'
            });
        }

        // Préparer les données à mettre à jour
        const updateData = {};
        if (location !== undefined) updateData.location = sanitizeInput(location);
        if (price !== undefined) updateData.price = parseFloat(price) || 0;
        if (notes !== undefined) updateData.notes = sanitizeInput(notes);
        if (sort_order !== undefined) updateData.sort_order = sort_order;
        if (is_active !== undefined) updateData.is_active = is_active;

        const { data: detail, error } = await supabase
            .from('budget_item_details')
            .update(updateData)
            .eq('id', detailId)
            .eq('budget_item_id', itemId)
            .select()
            .single();

        if (error) {
            logger.error('Error updating budget item detail:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la mise à jour du détail'
            });
        }

        // Recalculer le montant total si le prix a changé
        if (price !== undefined) {
            const { data: allDetails } = await supabase
                .from('budget_item_details')
                .select('price')
                .eq('budget_item_id', itemId)
                .eq('is_active', true);

            const totalDetailsPrice = (allDetails || []).reduce((sum, d) => sum + (parseFloat(d.price) || 0), 0);

            await supabase
                .from('budget_items')
                .update({ actual_amount: totalDetailsPrice })
                .eq('id', itemId);
        }

        logger.info(`Budget item detail updated: ${detailId} by user ${userId}`);

        res.json({
            success: true,
            data: detail,
            message: 'Détail mis à jour avec succès'
        });
    } catch (error) {
        logger.error('Update budget item detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * @route DELETE /api/budget/items/:itemId/details/:detailId
 * @desc Supprimer un détail d'item budget
 * @access Private
 */
router.delete('/items/:itemId/details/:detailId', authenticateToken, generalLimiter, async (req, res) => {
    try {
        const userId = req.user.id;
        const { itemId, detailId } = req.params;

        // Vérifier que l'item appartient à l'utilisateur
        const { data: item, error: itemError } = await supabase
            .from('budget_items')
            .select('id')
            .eq('id', itemId)
            .eq('user_id', userId)
            .single();

        if (itemError || !item) {
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé à cette dépense'
            });
        }

        const { error } = await supabase
            .from('budget_item_details')
            .delete()
            .eq('id', detailId)
            .eq('budget_item_id', itemId);

        if (error) {
            logger.error('Error deleting budget item detail:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression du détail'
            });
        }

        // Recalculer le montant total
        const { data: allDetails } = await supabase
            .from('budget_item_details')
            .select('price')
            .eq('budget_item_id', itemId)
            .eq('is_active', true);

        const totalDetailsPrice = (allDetails || []).reduce((sum, d) => sum + (parseFloat(d.price) || 0), 0);

        await supabase
            .from('budget_items')
            .update({ actual_amount: totalDetailsPrice })
            .eq('id', itemId);

        logger.info(`Budget item detail deleted: ${detailId} by user ${userId}`);

        res.json({
            success: true,
            message: 'Détail supprimé avec succès'
        });
    } catch (error) {
        logger.error('Delete budget item detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

module.exports = router;

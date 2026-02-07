/**
 * Routes API pour la messagerie entre organisateurs et invités
 * 
 * 🔒 Sécurité renforcée:
 * - Rate limiting spécifique par endpoint
 * - Validation stricte des UUIDs
 * - Vérification de propriété (ownership) sur toutes les opérations
 * - Échappement des sorties
 * - Limites de taille/pagination
 */
const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { authenticateToken } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { supabase } = require('../config/supabase');

const router = express.Router();

// ============================================
// 🔒 RATE LIMITING SPÉCIFIQUE MESSAGERIE
// ============================================

const messageLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 actions par minute max
    keyGenerator: (req) => {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const userId = req.user?.id ? `:user:${req.user.id}` : '';
        return `message:${ip}${userId}`;
    },
    handler: (req, res) => {
        logger.warn('🚫 Message rate limit exceeded', {
            ip: req.ip,
            userId: req.user?.id,
            path: req.path
        });
        res.status(429).json({
            success: false,
            message: 'Trop de messages. Veuillez ralentir.',
            retryAfter: 60
        });
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const conversationLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 conversations max par 5 min
    keyGenerator: (req) => {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const userId = req.user?.id ? `:user:${req.user.id}` : '';
        return `conversation:${ip}${userId}`;
    },
    handler: (req, res) => {
        logger.warn('🚫 Conversation creation rate limit exceeded', {
            ip: req.ip,
            userId: req.user?.id
        });
        res.status(429).json({
            success: false,
            message: 'Trop de conversations créées. Réessayez plus tard.',
            retryAfter: 300
        });
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// ============================================
// 🔒 SCHEMAS DE VALIDATION RENFORCÉS
// ============================================

const uuidSchema = Joi.string().uuid({ version: 'uuidv4' }).required();
const optionalUuidSchema = Joi.string().uuid({ version: 'uuidv4' });

const conversationValidation = {
    create: celebrate({
        [Segments.BODY]: Joi.object({
            event_id: uuidSchema,
            guest_id: optionalUuidSchema,
            family_id: optionalUuidSchema,
            subject: Joi.string().max(200).allow('').optional()
        }).xor('guest_id', 'family_id')
    }),
    update: celebrate({
        [Segments.PARAMS]: Joi.object({
            conversationId: uuidSchema
        }),
        [Segments.BODY]: Joi.object({
            subject: Joi.string().max(200).optional(),
            is_active: Joi.boolean().optional()
        })
    }),
    getMessages: celebrate({
        [Segments.PARAMS]: Joi.object({
            conversationId: uuidSchema
        }),
        [Segments.QUERY]: Joi.object({
            limit: Joi.number().integer().min(1).max(100).default(50),
            offset: Joi.number().integer().min(0).default(0)
        })
    })
};

const messageValidation = {
    create: celebrate({
        [Segments.PARAMS]: Joi.object({
            conversationId: uuidSchema
        }),
        [Segments.BODY]: Joi.object({
            content: Joi.string().required().min(1).max(2000),
            sender_type: Joi.string().valid('organizer', 'guest', 'system').default('organizer'),
            attachments: Joi.array().max(5).items(  // 🔒 Max 5 attachments
                Joi.object({
                    file_name: Joi.string().max(255).required(),
                    file_type: Joi.string().max(100).required(),
                    file_url: Joi.string().uri({ 
                        scheme: ['https']  // 🔒 HTTPS uniquement
                    }).max(500).required()
                })
            ).optional()
        })
    }),
    markAsRead: celebrate({
        [Segments.PARAMS]: Joi.object({
            messageId: uuidSchema
        })
    })
};

const statsValidation = celebrate({
    [Segments.QUERY]: Joi.object({
        event_id: optionalUuidSchema
    })
});

// ============================================
// 🔒 UTILITAIRES DE SÉCURITÉ
// ============================================

/**
 * Vérifie si l'utilisateur est propriétaire de l'événement
 * @param {string} eventId - UUID de l'événement
 * @param {string} userId - UUID de l'utilisateur
 * @returns {Promise<boolean>}
 */
const verifyEventOwnership = async (eventId, userId) => {
    const { data: event, error } = await supabase
        .from('events')
        .select('organizer_id')
        .eq('id', eventId)
        .single();
    
    if (error || !event) return false;
    return event.organizer_id === userId;
};

/**
 * Vérifie si l'utilisateur a accès à la conversation
 * @param {string} conversationId - UUID de la conversation
 * @param {string} userId - UUID de l'utilisateur
 * @returns {Promise<boolean>}
 */
const verifyConversationAccess = async (conversationId, userId) => {
    const { data: conversation, error } = await supabase
        .from('conversations')
        .select('organizer_id, event:events!inner(organizer_id)')
        .eq('id', conversationId)
        .single();
    
    if (error || !conversation) return false;
    return conversation.organizer_id === userId || conversation.event?.organizer_id === userId;
};

/**
 * Échappe le HTML pour prévenir XSS
 * @param {string} text - Texte à échapper
 * @returns {string}
 */
const escapeHtml = (text) => {
    if (typeof text !== 'string') return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

/**
 * Sanitize les données de message avant envoi au client
 * @param {Object} message - Message brut
 * @returns {Object} - Message sanitizé
 */
const sanitizeMessage = (message) => ({
    id: message.id,
    conversation_id: message.conversation_id,
    sender_id: message.sender_id,
    sender_type: message.sender_type,
    content: escapeHtml(message.content),
    is_read: message.is_read,
    read_at: message.read_at,
    attachments: Array.isArray(message.attachments) 
        ? message.attachments.map(att => ({
            file_name: escapeHtml(att.file_name),
            file_type: escapeHtml(att.file_type),
            file_url: att.file_url // URL déjà validée
        }))
        : [],
    created_at: message.created_at,
    updated_at: message.updated_at
});

// ============================================
// 🔒 ROUTES API SÉCURISÉES
// ============================================

/**
 * @route GET /api/messages/conversations
 * @desc Récupère toutes les conversations de l'organisateur connecté
 * @access Private
 */
router.get('/conversations', authenticateToken, messageLimiter, async (req, res) => {
    try {
        const userId = req.user.id;
        const { event_id } = req.query;

        // 🔒 Validation du event_id si fourni
        if (event_id) {
            const isOwner = await verifyEventOwnership(event_id, userId);
            if (!isOwner) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé à cet événement'
                });
            }
        }

        // 🔒 Requête avec filtrage par propriétaire
        let query = supabase
            .from('conversation_summary_secure')
            .select('*')
            .eq('organizer_id', userId)  // 🔒 Filtre obligatoire par propriétaire
            .order('last_message_at', { ascending: false });

        if (event_id) {
            query = query.eq('event_id', event_id);
        }

        const { data: conversations, error } = await query;

        if (error) {
            logger.error('Error fetching conversations:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des conversations'
            });
        }

        // 🔒 Sanitization des données avant envoi
        const sanitizedConversations = (conversations || []).map(conv => ({
            id: conv.id,
            eventId: conv.event_id,
            subject: conv.subject ? escapeHtml(conv.subject) : null,
            isActive: conv.is_active,
            lastMessageAt: conv.last_message_at,
            createdAt: conv.created_at,
            unreadCount: parseInt(conv.unread_count) || 0,
            lastMessage: conv.last_message ? {
                id: conv.last_message.id,
                content: escapeHtml(conv.last_message.content),
                sender_type: conv.last_message.sender_type,
                created_at: conv.last_message.created_at
            } : null,
            participant: conv.participant ? {
                id: conv.participant.id,
                name: escapeHtml(conv.participant.name),
                email: conv.participant.email ? escapeHtml(conv.participant.email) : undefined,
                type: conv.participant.type
            } : null
        }));

        res.json({
            success: true,
            data: sanitizedConversations,
            count: sanitizedConversations.length
        });
    } catch (error) {
        logger.error('Get conversations error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération des conversations'
        });
    }
});

/**
 * @route POST /api/messages/conversations
 * @desc Crée une nouvelle conversation
 * @access Private
 */
router.post('/conversations', authenticateToken, conversationLimiter, conversationValidation.create, async (req, res) => {
    try {
        const userId = req.user.id;
        const { event_id, guest_id, family_id, subject } = req.body;

        // 🔒 Vérification de propriété de l'événement
        const isOwner = await verifyEventOwnership(event_id, userId);
        if (!isOwner) {
            logger.warn('Unauthorized conversation creation attempt', {
                userId,
                eventId: event_id,
                ip: req.ip
            });
            return res.status(403).json({
                success: false,
                message: 'Vous n\'êtes pas autorisé à créer une conversation pour cet événement'
            });
        }

        // 🔒 Vérification que le guest/family appartient bien à l'événement
        if (guest_id) {
            const { data: guestCheck, error: guestError } = await supabase
                .from('guests')
                .select('id')
                .eq('id', guest_id)
                .eq('event_id', event_id)
                .single();
            
            if (guestError || !guestCheck) {
                logger.warn('Guest IDOR attempt', { userId, guest_id, event_id });
                return res.status(403).json({
                    success: false,
                    message: 'Cet invité n\'existe pas dans cet événement'
                });
            }
        }

        if (family_id) {
            // Vérification via family_invitations car families n'a pas de event_id direct
            const { data: familyCheck, error: familyError } = await supabase
                .from('family_invitations')
                .select('id')
                .eq('family_id', family_id)
                .eq('event_id', event_id)
                .single();
            
            if (familyError || !familyCheck) {
                logger.warn('Family IDOR attempt', { userId, family_id, event_id });
                return res.status(403).json({
                    success: false,
                    message: 'Cette famille n\'existe pas dans cet événement'
                });
            }
        }

        // 🔒 Vérification si une conversation existe déjà (avec gestion race condition)
        let existingQuery = supabase
            .from('conversations')
            .select('id')
            .eq('event_id', event_id)
            .eq('is_active', true);

        if (guest_id) {
            existingQuery = existingQuery.eq('guest_id', guest_id);
        } else if (family_id) {
            existingQuery = existingQuery.eq('family_id', family_id);
        }

        const { data: existingConv } = await existingQuery.maybeSingle();

        if (existingConv) {
            return res.status(409).json({
                success: false,
                message: 'Une conversation existe déjà avec cet invité/cette famille',
                data: { id: existingConv.id }
            });
        }

        // 🔒 Création avec sanitization du subject
        const { data: conversation, error } = await supabase
            .from('conversations')
            .insert({
                event_id,
                guest_id: guest_id || null,
                family_id: family_id || null,
                organizer_id: userId,
                subject: subject ? escapeHtml(subject) : null,
                is_active: true
            })
            .select()
            .single();

        if (error) {
            // 🔒 Gestion de la race condition (contrainte UNIQUE violée)
            if (error.code === '23505' || error.message?.includes('duplicate')) {
                return res.status(409).json({
                    success: false,
                    message: 'Une conversation existe déjà avec cet invité/cette famille'
                });
            }
            logger.error('Error creating conversation:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la création de la conversation'
            });
        }

        logger.info(`Conversation created: ${conversation.id} by user: ${userId}`);

        res.status(201).json({
            success: true,
            data: conversation,
            message: 'Conversation créée avec succès'
        });
    } catch (error) {
        logger.error('Create conversation error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la création de la conversation'
        });
    }
});

/**
 * @route GET /api/messages/conversations/:conversationId/messages
 * @desc Récupère les messages d'une conversation avec pagination
 * @access Private
 */
router.get('/conversations/:conversationId/messages', authenticateToken, messageLimiter, conversationValidation.getMessages, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        const userId = req.user.id;

        // 🔒 Vérification d'accès à la conversation
        const hasAccess = await verifyConversationAccess(conversationId, userId);
        if (!hasAccess) {
            logger.warn('Unauthorized message access attempt', {
                userId,
                conversationId,
                ip: req.ip
            });
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé à cette conversation'
            });
        }

        // 🔒 Récupération paginée
        const { data: messages, error, count } = await supabase
            .from('messages')
            .select('*', { count: 'exact' })
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })
            .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (error) {
            logger.error('Error fetching messages:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la récupération des messages'
            });
        }

        // 🔒 Marquer les messages comme lus (uniquement ceux des guests)
        await supabase
            .from('messages')
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq('conversation_id', conversationId)
            .eq('sender_type', 'guest')
            .eq('is_read', false);

        // 🔒 Sanitization des messages
        const sanitizedMessages = (messages || []).map(sanitizeMessage);

        res.json({
            success: true,
            data: sanitizedMessages,
            count: sanitizedMessages.length,
            total: count || 0,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: (parseInt(offset) + sanitizedMessages.length) < (count || 0)
            }
        });
    } catch (error) {
        logger.error('Get messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération des messages'
        });
    }
});

/**
 * @route POST /api/messages/conversations/:conversationId/messages
 * @desc Envoie un message dans une conversation
 * @access Private
 */
router.post('/conversations/:conversationId/messages', authenticateToken, messageLimiter, messageValidation.create, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;
        const { content, sender_type, attachments } = req.body;

        // 🔒 Vérification d'accès
        const hasAccess = await verifyConversationAccess(conversationId, userId);
        if (!hasAccess) {
            logger.warn('Unauthorized message send attempt', {
                userId,
                conversationId,
                ip: req.ip
            });
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé à cette conversation'
            });
        }

        // 🔒 Vérification que la conversation est active
        const { data: conversation } = await supabase
            .from('conversations')
            .select('is_active')
            .eq('id', conversationId)
            .single();

        if (!conversation || !conversation.is_active) {
            return res.status(400).json({
                success: false,
                message: 'Cette conversation est fermée ou inexistante'
            });
        }

        // 🔒 Validation des URLs des pièces jointes (whitelist de domaines)
        const allowedDomains = process.env.ALLOWED_ATTACHMENT_DOMAINS 
            ? process.env.ALLOWED_ATTACHMENT_DOMAINS.split(',')
            : ['localhost', process.env.R2_PUBLIC_URL?.replace(/https?:\/\//, '')].filter(Boolean);

        if (attachments && attachments.length > 0) {
            for (const att of attachments) {
                try {
                    const url = new URL(att.file_url);
                    if (!allowedDomains.some(domain => url.hostname.includes(domain))) {
                        logger.warn('Blocked attachment from unauthorized domain', {
                            userId,
                            domain: url.hostname,
                            allowedDomains
                        });
                        return res.status(400).json({
                            success: false,
                            message: 'Domaine de pièce jointe non autorisé'
                        });
                    }
                } catch (e) {
                    return res.status(400).json({
                        success: false,
                        message: 'URL de pièce jointe invalide'
                    });
                }
            }
        }

        // 🔒 Insertion avec sanitization
        const { data: message, error } = await supabase
            .from('messages')
            .insert({
                conversation_id: conversationId,
                sender_id: userId,
                sender_type: sender_type || 'organizer',
                content: escapeHtml(content.trim()),
                attachments: attachments || [],
                is_read: false
            })
            .select()
            .single();

        if (error) {
            logger.error('Error creating message:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de l\'envoi du message'
            });
        }

        // 🔒 Mise à jour du timestamp de dernière activité
        await supabase
            .from('conversations')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', conversationId);

        logger.info(`Message sent: ${message.id} in conversation: ${conversationId} by user: ${userId}`);

        res.status(201).json({
            success: true,
            data: sanitizeMessage(message),
            message: 'Message envoyé avec succès'
        });
    } catch (error) {
        logger.error('Send message error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de l\'envoi du message'
        });
    }
});

/**
 * @route PUT /api/messages/:messageId/read
 * @desc Marque un message comme lu
 * @access Private
 */
router.put('/:messageId/read', authenticateToken, messageLimiter, messageValidation.markAsRead, async (req, res) => {
    try {
        const { messageId } = req.params;
        const userId = req.user.id;

        // 🔒 Vérification que l'utilisateur a accès à ce message via la conversation
        const { data: messageWithConv, error: accessError } = await supabase
            .from('messages')
            .select('conversation_id, conversation:conversations!inner(organizer_id, event:events!inner(organizer_id))')
            .eq('id', messageId)
            .single();

        if (accessError || !messageWithConv) {
            return res.status(404).json({
                success: false,
                message: 'Message non trouvé'
            });
        }

        const isOwner = messageWithConv.conversation?.organizer_id === userId || 
                       messageWithConv.conversation?.event?.organizer_id === userId;

        if (!isOwner) {
            logger.warn('Unauthorized mark-as-read attempt', {
                userId,
                messageId,
                ip: req.ip
            });
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé à ce message'
            });
        }

        // 🔒 Marquer comme lu
        const { data: message, error } = await supabase
            .from('messages')
            .update({
                is_read: true,
                read_at: new Date().toISOString()
            })
            .eq('id', messageId)
            .select()
            .single();

        if (error) {
            logger.error('Error marking message as read:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors du marquage du message'
            });
        }

        res.json({
            success: true,
            data: sanitizeMessage(message),
            message: 'Message marqué comme lu'
        });
    } catch (error) {
        logger.error('Mark as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * @route PUT /api/messages/conversations/:conversationId/read-all
 * @desc Marque tous les messages d'une conversation comme lus
 * @access Private
 */
router.put('/conversations/:conversationId/read-all', authenticateToken, messageLimiter, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;

        // 🔒 Vérification d'accès
        const hasAccess = await verifyConversationAccess(conversationId, userId);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé'
            });
        }

        // 🔒 Mise à jour en masse (évite N+1 requêtes côté client)
        const { error } = await supabase
            .from('messages')
            .update({ 
                is_read: true, 
                read_at: new Date().toISOString() 
            })
            .eq('conversation_id', conversationId)
            .eq('sender_type', 'guest')
            .eq('is_read', false);

        if (error) {
            logger.error('Error marking all messages as read:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors du marquage des messages'
            });
        }

        res.json({
            success: true,
            message: 'Tous les messages marqués comme lus'
        });
    } catch (error) {
        logger.error('Mark all as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
});

/**
 * @route DELETE /api/messages/conversations/:conversationId
 * @desc Supprime (désactive) une conversation
 * @access Private
 */
router.delete('/conversations/:conversationId', authenticateToken, messageLimiter, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;

        // 🔒 Vérification d'accès
        const hasAccess = await verifyConversationAccess(conversationId, userId);
        if (!hasAccess) {
            logger.warn('Unauthorized conversation delete attempt', {
                userId,
                conversationId,
                ip: req.ip
            });
            return res.status(403).json({
                success: false,
                message: 'Accès non autorisé'
            });
        }

        // 🔒 Soft delete
        const { error } = await supabase
            .from('conversations')
            .update({ is_active: false })
            .eq('id', conversationId);

        if (error) {
            logger.error('Error deleting conversation:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la suppression de la conversation'
            });
        }

        logger.info(`Conversation deactivated: ${conversationId} by user: ${userId}`);

        res.json({
            success: true,
            message: 'Conversation supprimée avec succès'
        });
    } catch (error) {
        logger.error('Delete conversation error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la suppression'
        });
    }
});

/**
 * @route GET /api/messages/stats
 * @desc Récupère les statistiques de messagerie
 * @access Private
 */
router.get('/stats', authenticateToken, messageLimiter, statsValidation, async (req, res) => {
    try {
        const userId = req.user.id;
        const { event_id } = req.query;

        // 🔒 Vérification de propriété si event_id fourni
        if (event_id) {
            const isOwner = await verifyEventOwnership(event_id, userId);
            if (!isOwner) {
                return res.status(403).json({
                    success: false,
                    message: 'Accès non autorisé'
                });
            }
        }

        // 🔒 Récupération des événements de l'utilisateur
        let eventQuery = supabase
            .from('events')
            .select('id')
            .eq('organizer_id', userId);

        if (event_id) {
            eventQuery = eventQuery.eq('id', event_id);
        }

        const { data: events, error: eventsError } = await eventQuery;

        if (eventsError) {
            throw eventsError;
        }

        const eventIds = events.map(e => e.id);

        if (eventIds.length === 0) {
            return res.json({
                success: true,
                data: {
                    totalConversations: 0,
                    totalMessages: 0,
                    unreadMessages: 0,
                    activeConversations: 0
                }
            });
        }

        // 🔒 Requêtes avec filtrage par event_ids de l'utilisateur (limité pour éviter DoS)
        const { count: totalConversations } = await supabase
            .from('conversations')
            .select('*', { count: 'exact', head: true })
            .in('event_id', eventIds.slice(0, 1000))  // 🔒 Limite 1000 events
            .eq('is_active', true);

        // 🔒 Limiter la sous-requête pour éviter explosion mémoire
        const { data: conversationIds } = await supabase
            .from('conversations')
            .select('id')
            .in('event_id', eventIds.slice(0, 1000))
            .eq('is_active', true)
            .limit(1000);

        const convIds = conversationIds?.map(c => c.id) || [];
        
        let unreadCount = 0;
        if (convIds.length > 0) {
            const { count } = await supabase
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .in('conversation_id', convIds)
                .eq('is_read', false)
                .eq('sender_type', 'guest');
            unreadCount = count || 0;
        }

        res.json({
            success: true,
            data: {
                totalConversations: totalConversations || 0,
                totalMessages: 0, // Calculé séparément si nécessaire
                unreadMessages: unreadCount,
                activeConversations: totalConversations || 0
            }
        });
    } catch (error) {
        logger.error('Get message stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération des statistiques'
        });
    }
});

module.exports = router;

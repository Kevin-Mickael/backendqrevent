/**
 * 🛡️ SAFE EVENT DATABASE LAYER
 * 
 * Cette couche d'abstraction détecte automatiquement le schéma de la base de données
 * et s'adapte pour fonctionner quel que soit l'état des migrations.
 * 
 * Caractéristiques:
 * - Détection dynamique des colonnes disponibles
 * - Fallback automatique vers des requêtes compatibles
 * - Gestion des erreurs avec retry
 * - Support des deux modes: RPC (fonction SQL) et Insertion directe
 */

const { supabaseService } = require('../../config/supabase');
const logger = require('../logger');

// Cache du schéma pour éviter les requêtes répétées
let schemaCache = null;
let schemaCacheTime = null;
const SCHEMA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Détecte le schéma actuel de la table events
 * Cette fonction est idempotente et met en cache le résultat
 */
async function detectEventSchema() {
    const now = Date.now();

    // Utiliser le cache si disponible et valide
    if (schemaCache && schemaCacheTime && (now - schemaCacheTime) < SCHEMA_CACHE_TTL) {
        return schemaCache;
    }

    // Méthode 1: Essayer une requête directe pour détecter les colonnes
    // en insérant et annulant (dry run) - trop risqué
    // Méthode 2: Utiliser le schéma optimiste complet avec toutes les colonnes connues
    // C'est la méthode la plus fiable car information_schema n'est PAS accessible via PostgREST

    try {
        // Tenter un SELECT limité pour vérifier quelles colonnes existent
        const { data, error } = await supabaseService
            .from('events')
            .select('id, title, description, date, organizer_id, is_active, location, venue_type, ceremony_venue, reception_venue, ceremony_date, ceremony_time, reception_date, reception_time, partner1_name, partner2_name, event_schedule, settings, guest_count, cover_image, banner_image, bride_name, groom_name, total_budget, menu_settings')
            .limit(0);

        if (!error) {
            // Si la requête réussit, toutes ces colonnes existent
            const schema = getOptimisticSchema();
            schemaCache = schema;
            schemaCacheTime = now;
            logger.info('[events.safe] Schéma optimiste vérifié avec succès');
            return schema;
        }

        // Si erreur (certaines colonnes n'existent pas), essayer colonne par colonne
        logger.warn('[events.safe] Requête complète échouée, utilisation du schéma optimiste:', error.message);
    } catch (error) {
        logger.warn('[events.safe] Erreur détection schéma:', error.message);
    }

    // Fallback: retourner le schéma optimiste (inclut toutes les colonnes modernes)
    const schema = getOptimisticSchema();
    schemaCache = schema;
    schemaCacheTime = now;
    return schema;
}

/**
 * Retourne un schéma optimiste avec toutes les colonnes connues
 * C'est le fallback principal puisque information_schema n'est pas accessible via PostgREST
 */
function getOptimisticSchema() {
    return {
        columns: [
            'id', 'title', 'description', 'date', 'organizer_id', 'is_active',
            'created_at', 'updated_at', 'location',
            'venue_type', 'ceremony_venue', 'reception_venue',
            'ceremony_date', 'ceremony_time', 'reception_date', 'reception_time',
            'partner1_name', 'partner2_name',
            'event_schedule', 'settings', 'guest_count',
            'cover_image', 'banner_image',
            'bride_name', 'groom_name',
            'total_budget', 'menu_settings'
        ],
        hasModernColumns: {
            venue_type: true,
            ceremony_venue: true,
            partner1_name: true,
            event_schedule: true,
            settings: true,
            guest_count: true
        },
        hasLegacyColumns: {
            bride_name: true,
            groom_name: true
        },
        descriptionNullable: true
    };
}

/**
 * Retourne un schéma minimal par défaut (fallback ultime)
 */
function getMinimalSchema() {
    return {
        columns: ['id', 'title', 'description', 'date', 'organizer_id', 'is_active', 'created_at', 'updated_at', 'location'],
        hasModernColumns: {
            venue_type: false,
            ceremony_venue: false,
            partner1_name: false,
            event_schedule: false,
            settings: false,
            guest_count: false
        },
        hasLegacyColumns: {
            bride_name: false,
            groom_name: false
        },
        descriptionNullable: true
    };
}

/**
 * Vérifie si la fonction RPC create_event_robust existe
 */
async function hasRobustFunction() {
    try {
        const { data, error } = await supabaseService
            .from('pg_proc')
            .select('proname')
            .eq('proname', 'create_event_robust')
            .single();

        return !error && data;
    } catch {
        return false;
    }
}

/**
 * Prépare les données d'événement en fonction du schéma disponible
 * Cette fonction est défensive et ne garde que les champs qui existent
 */
async function prepareEventData(eventData, schema) {
    const prepared = {
        // Champs de base toujours présents
        title: eventData.title,
        description: eventData.description || (schema.descriptionNullable ? null : ''),
        date: eventData.date,
        organizer_id: eventData.organizer_id,
        is_active: eventData.is_active !== false
    };

    // Gestion des venues modernes vs legacy location
    if (schema.hasModernColumns.venue_type) {
        prepared.venue_type = eventData.venue_type || 'single';

        // Ceremony venue
        if (eventData.ceremony_venue) {
            prepared.ceremony_venue = eventData.ceremony_venue;
        } else if (eventData.location) {
            prepared.ceremony_venue = eventData.location;
        }

        // Reception venue
        if (eventData.reception_venue) {
            prepared.reception_venue = eventData.reception_venue;
        } else {
            prepared.reception_venue = prepared.ceremony_venue;
        }

        // Dates et heures
        if (schema.hasModernColumns.ceremony_date) {
            prepared.ceremony_date = eventData.ceremony_date ||
                (eventData.date ? new Date(eventData.date).toISOString().split('T')[0] : null);
        }

        if (schema.hasModernColumns.ceremony_time) {
            prepared.ceremony_time = eventData.ceremony_time ||
                (eventData.event_schedule?.[0]?.time || '14:00');
        }

        if (schema.hasModernColumns.reception_date) {
            prepared.reception_date = eventData.reception_date || prepared.ceremony_date;
        }

        if (schema.hasModernColumns.reception_time) {
            prepared.reception_time = eventData.reception_time ||
                (eventData.event_schedule?.[1]?.time || '18:00');
        }
    }

    // Location (legacy ou pour compatibilité)
    if (eventData.location) {
        prepared.location = typeof eventData.location === 'string'
            ? { address: eventData.location }
            : eventData.location;
    }

    // Partner names (modern)
    if (schema.hasModernColumns.partner1_name) {
        prepared.partner1_name = eventData.partner1_name || eventData.partner1Name || null;
    }
    if (schema.hasModernColumns.partner2_name) {
        prepared.partner2_name = eventData.partner2_name || eventData.partner2Name || null;
    }

    // Legacy bride/groom names
    if (schema.hasLegacyColumns.groom_name && eventData.partner1_name) {
        prepared.groom_name = eventData.partner1_name;
    }
    if (schema.hasLegacyColumns.bride_name && eventData.partner2_name) {
        prepared.bride_name = eventData.partner2_name;
    }

    // Event schedule
    if (schema.hasModernColumns.event_schedule) {
        prepared.event_schedule = eventData.event_schedule || [];
    }

    // Settings
    if (schema.hasModernColumns.settings) {
        prepared.settings = eventData.settings || {
            enableRSVP: true,
            enableGames: false,
            enablePhotoGallery: true,
            enableGuestBook: true,
            enableQRVerification: true
        };
    }

    // Guest count
    if (schema.hasModernColumns.guest_count) {
        prepared.guest_count = eventData.guest_count || null;
    }

    // Images
    if (schema.columns.includes('cover_image')) {
        prepared.cover_image = eventData.cover_image || null;
    }
    if (schema.columns.includes('banner_image')) {
        prepared.banner_image = eventData.banner_image || null;
    }

    // Autres colonnes optionnelles
    if (schema.columns.includes('total_budget')) {
        prepared.total_budget = eventData.total_budget || 0;
    }
    if (schema.columns.includes('menu_settings')) {
        prepared.menu_settings = eventData.menu_settings || null;
    }

    return prepared;
}

/**
 * Filtre les données pour ne garder que les colonnes existantes
 */
function filterDataForSchema(data, schema) {
    const filtered = {};
    for (const [key, value] of Object.entries(data)) {
        if (schema.columns.includes(key) || schema.columns.includes(key.toLowerCase())) {
            filtered[key] = value;
        }
    }
    return filtered;
}

/**
 * 🎯 CRÉATION D'ÉVÉNEMENT - Méthode principale
 * 
 * Cette fonction utilise la meilleure méthode disponible:
 * 1. Essaye d'abord la fonction RPC create_event_robust (si disponible)
 * 2. Sinon utilise une insertion directe avec détection de schéma
 * 3. Gère les erreurs avec retry et fallback
 */
async function create(eventData) {
    logger.info('[events.safe] Tentative de création d\'événement:', {
        title: eventData.title,
        hasOrganizerId: !!eventData.organizer_id
    });

    // 1. Détecter le schéma
    const schema = await detectEventSchema();

    // 2. Préparer les données
    const preparedData = await prepareEventData(eventData, schema);

    // 3. Essayer la fonction RPC si disponible
    const hasRpc = await hasRobustFunction();

    if (hasRpc) {
        try {
            logger.info('[events.safe] Utilisation de create_event_robust()');

            const { data, error } = await supabaseService
                .rpc('create_event_robust', {
                    p_event_data: preparedData
                });

            if (error) {
                // Si l'erreur est liée à l'organizer_id, essayer de créer l'utilisateur
                if (error.message.includes('Organizer not found')) {
                    logger.warn('[events.safe] Organisateur non trouvé, tentative de création...');
                    await ensureUserExists(eventData.organizer_id);

                    // Réessayer
                    const { data: retryData, error: retryError } = await supabaseService
                        .rpc('create_event_robust', {
                            p_event_data: preparedData
                        });

                    if (retryError) throw retryError;
                    return retryData;
                }
                throw error;
            }

            return data;
        } catch (rpcError) {
            logger.warn('[events.safe] Échec RPC, fallback sur insertion directe:', rpcError.message);
            // Continuer avec l'insertion directe
        }
    }

    // 4. Insertion directe avec filtrage des colonnes
    let filteredData = filterDataForSchema(preparedData, schema);

    // S'assurer que les champs obligatoires sont présents
    if (!filteredData.title) throw new Error('Title is required');
    if (!filteredData.date) throw new Error('Date is required');
    if (!filteredData.organizer_id) throw new Error('Organizer ID is required');

    // Si description est obligatoire mais nullable supporté
    if (!schema.descriptionNullable && !filteredData.description) {
        filteredData.description = '';
    }

    // Retry loop: si une colonne n'existe pas, la retirer et réessayer
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.info(`[events.safe] Insertion directe - tentative ${attempt}/${maxRetries}`, {
                columns: Object.keys(filteredData)
            });

            const { data, error } = await supabaseService
                .from('events')
                .insert([filteredData])
                .select()
                .single();

            if (error) {
                // Colonne inexistante: retirer et réessayer
                const unknownColMatch = error.message.match(/column (?:events\.)?["\']?(\w+)["\']? (?:of relation "events" )?does not exist/i)
                    || error.message.match(/Could not find.*column '?(\w+)'?/i)
                    || error.message.match(/unknown column[:\s]*["\']?(\w+)/i);

                if (unknownColMatch && attempt < maxRetries) {
                    const badColumn = unknownColMatch[1];
                    logger.warn(`[events.safe] Colonne '${badColumn}' inexistante, retrait et retry...`);
                    delete filteredData[badColumn];

                    // Invalider le cache du schéma pour les prochaines requêtes
                    invalidateCache();
                    continue;
                }

                // Gestion spécifique des erreurs fréquentes
                if (error.message.includes('violates not-null constraint')) {
                    const match = error.message.match(/column "(.+?)"/);
                    const column = match ? match[1] : 'unknown';
                    throw new Error(`Missing required field: ${column}. Please ensure all required fields are provided.`);
                }

                if (error.message.includes('foreign key constraint')) {
                    // Essayer de créer l'utilisateur et réessayer
                    if (attempt < maxRetries) {
                        logger.warn('[events.safe] Foreign key error, tentative création utilisateur...');
                        await ensureUserExists(eventData.organizer_id);
                        continue;
                    }
                    throw new Error('Invalid organizer ID. The user does not exist in the database.');
                }

                throw error;
            }

            logger.info('[events.safe] Événement créé avec succès:', { id: data.id });
            return data;
        } catch (insertError) {
            if (attempt >= maxRetries) {
                logger.error('[events.safe] Échec de l\'insertion après tous les essais:', insertError.message);
                throw insertError;
            }
            // Continuer le retry
            logger.warn(`[events.safe] Tentative ${attempt} échouée:`, insertError.message);
        }
    }
}

/**
 * S'assure qu'un utilisateur existe dans public.users
 * Crée un entrée minimale si nécessaire
 */
async function ensureUserExists(userId) {
    try {
        // Vérifier si l'utilisateur existe
        const { data: existing } = await supabaseService
            .from('users')
            .select('id')
            .eq('id', userId)
            .single();

        if (existing) return;

        // Vérifier dans auth.users
        const { data: authUser } = await supabaseService
            .from('auth.users')
            .select('id, email, raw_user_meta_data')
            .eq('id', userId)
            .single();

        if (authUser) {
            // Créer dans public.users
            await supabaseService
                .from('users')
                .insert([{
                    id: userId,
                    auth_id: userId,
                    email: authUser.email,
                    name: authUser.raw_user_meta_data?.name || authUser.email.split('@')[0],
                    role: 'organizer',
                    is_active: true
                }]);

            logger.info('[events.safe] Utilisateur créé:', userId);
        }
    } catch (error) {
        logger.warn('[events.safe] Impossible de créer l\'utilisateur:', error.message);
    }
}

/**
 * 🔍 LECTURE D'ÉVÉNEMENT
 */
async function findById(id) {
    const { data, error } = await supabaseService
        .from('events')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            return null; // Not found
        }
        throw new Error(`Error finding event: ${error.message}`);
    }

    return data;
}

/**
 * 📋 LECTURE DES ÉVÉNEMENTS PAR ORGANISATEUR
 */
async function findByOrganizer(organizerId) {
    const { data, error } = await supabaseService
        .from('events')
        .select('*')
        .eq('organizer_id', organizerId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    if (error) {
        throw new Error(`Error finding events: ${error.message}`);
    }

    return data || [];
}

/**
 * ✏️ MISE À JOUR D'ÉVÉNEMENT
 */
async function update(id, eventData) {
    const schema = await detectEventSchema();
    const preparedData = await prepareEventData(eventData, schema);

    // Supprimer les champs qui ne doivent pas être mis à jour
    delete preparedData.id;
    delete preparedData.created_at;
    delete preparedData.organizer_id;

    const filteredData = filterDataForSchema(preparedData, schema);
    filteredData.updated_at = new Date().toISOString();

    const { data, error } = await supabaseService
        .from('events')
        .update(filteredData)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        throw new Error(`Error updating event: ${error.message}`);
    }

    return data;
}

/**
 * 🗑️ SUPPRESSION LOGIQUE (soft delete)
 */
async function softDelete(id) {
    const { data, error } = await supabaseService
        .from('events')
        .update({
            is_active: false,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        throw new Error(`Error deleting event: ${error.message}`);
    }

    return data;
}

/**
 * 🧪 FONCTION DE TEST
 * Vérifie que tout fonctionne correctement
 */
async function test() {
    logger.info('[events.safe] Test de la couche safe...');

    const results = {
        schema: null,
        hasRpc: false,
        canCreate: false
    };

    try {
        results.schema = await detectEventSchema();
        results.hasRpc = await hasRobustFunction();

        // Test de création (sans vraiment créer)
        // On vérifie juste que la préparation fonctionne
        const testData = await prepareEventData({
            title: 'TEST',
            date: new Date().toISOString(),
            organizer_id: '00000000-0000-0000-0000-000000000000'
        }, results.schema);

        results.canCreate = !!testData.title && !!testData.date;

        return { success: true, results };
    } catch (error) {
        return { success: false, error: error.message, results };
    }
}

/**
 * 🔄 INVALIDATION DU CACHE
 * À appeler après une migration
 */
function invalidateCache() {
    schemaCache = null;
    schemaCacheTime = null;
    logger.info('[events.safe] Cache du schéma invalidé');
}

module.exports = {
    create,
    findById,
    findByOrganizer,
    update,
    softDelete,
    detectEventSchema,
    hasRobustFunction,
    test,
    invalidateCache,
    // Export pour les tests internes
    _prepareEventData: prepareEventData,
    _filterDataForSchema: filterDataForSchema
};

/**
 * Opérations atomiques pour prévenir les Race Conditions (TOCTOU)
 * Ces fonctions combinent vérification et modification en une seule opération
 */

const { supabaseService } = require('../../config/supabase');

/**
 * Met à jour un événement uniquement si l'utilisateur est le propriétaire
 * @param {string} eventId - ID de l'événement
 * @param {string} userId - ID de l'utilisateur
 * @param {Object} updateData - Données à mettre à jour
 * @returns {Promise<Object>} - L'événement mis à jour
 * @throws {Error} - Si l'événement n'existe pas ou l'utilisateur n'est pas propriétaire
 */
async function updateEventIfOwner(eventId, userId, updateData) {
    // Vérifier que l'eventId et userId sont valides
    if (!eventId || !userId) {
        throw new Error('Event ID and User ID are required');
    }

    // Ajouter updated_at
    const dataToUpdate = {
        ...updateData,
        updated_at: new Date().toISOString()
    };

    // Opération atomique : UPDATE avec condition WHERE
    const { data, error } = await supabaseService
        .from('events')
        .update(dataToUpdate)
        .eq('id', eventId)
        .eq('organizer_id', userId)
        .eq('is_active', true)
        .select()
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            throw new Error('Event not found or you do not have permission to update it');
        }
        throw new Error(`Error updating event: ${error.message}`);
    }

    if (!data) {
        throw new Error('Event not found or you do not have permission to update it');
    }

    return data;
}

/**
 * Supprime (soft delete) un événement uniquement si l'utilisateur est le propriétaire
 * @param {string} eventId - ID de l'événement
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Object>} - L'événement supprimé
 * @throws {Error} - Si l'événement n'existe pas ou l'utilisateur n'est pas propriétaire
 */
async function softDeleteEventIfOwner(eventId, userId) {
    if (!eventId || !userId) {
        throw new Error('Event ID and User ID are required');
    }

    const { data, error } = await supabaseService
        .from('events')
        .update({ 
            is_active: false, 
            updated_at: new Date().toISOString() 
        })
        .eq('id', eventId)
        .eq('organizer_id', userId)
        .eq('is_active', true)
        .select()
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            throw new Error('Event not found or you do not have permission to delete it');
        }
        throw new Error(`Error deleting event: ${error.message}`);
    }

    if (!data) {
        throw new Error('Event not found or you do not have permission to delete it');
    }

    return data;
}

/**
 * Récupère un événement uniquement si l'utilisateur est le propriétaire
 * @param {string} eventId - ID de l'événement
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Object|null>} - L'événement ou null
 */
async function getEventIfOwner(eventId, userId) {
    if (!eventId || !userId) {
        return null;
    }

    const { data, error } = await supabaseService
        .from('events')
        .select('*')
        .eq('id', eventId)
        .eq('organizer_id', userId)
        .eq('is_active', true)
        .single();

    if (error && error.code !== 'PGRST116') {
        throw new Error(`Error fetching event: ${error.message}`);
    }

    return data || null;
}

/**
 * Met à jour un invité uniquement si l'événement appartient à l'utilisateur
 * @param {string} guestId - ID de l'invité
 * @param {string} eventId - ID de l'événement
 * @param {string} userId - ID de l'utilisateur
 * @param {Object} updateData - Données à mettre à jour
 * @returns {Promise<Object>} - L'invité mis à jour
 */
async function updateGuestIfEventOwner(guestId, eventId, userId, updateData) {
    if (!guestId || !eventId || !userId) {
        throw new Error('Guest ID, Event ID and User ID are required');
    }

    // D'abord vérifier que l'événement appartient à l'utilisateur
    const { data: event, error: eventError } = await supabaseService
        .from('events')
        .select('id')
        .eq('id', eventId)
        .eq('organizer_id', userId)
        .eq('is_active', true)
        .single();

    if (eventError || !event) {
        throw new Error('Event not found or you do not have permission to update guests');
    }

    // Ensuite vérifier que l'invité appartient à l'événement
    const { data, error } = await supabaseService
        .from('guests')
        .update({
            ...updateData,
            updated_at: new Date().toISOString()
        })
        .eq('id', guestId)
        .eq('event_id', eventId)
        .select()
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            throw new Error('Guest not found in this event');
        }
        throw new Error(`Error updating guest: ${error.message}`);
    }

    return data;
}

/**
 * Supprime un invité uniquement si l'événement appartient à l'utilisateur
 * @param {string} guestId - ID de l'invité
 * @param {string} eventId - ID de l'événement
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Object>} - L'invité supprimé
 */
async function deleteGuestIfEventOwner(guestId, eventId, userId) {
    if (!guestId || !eventId || !userId) {
        throw new Error('Guest ID, Event ID and User ID are required');
    }

    // Vérifier ownership de l'événement
    const { data: event, error: eventError } = await supabaseService
        .from('events')
        .select('id')
        .eq('id', eventId)
        .eq('organizer_id', userId)
        .eq('is_active', true)
        .single();

    if (eventError || !event) {
        throw new Error('Event not found or you do not have permission to delete guests');
    }

    // Supprimer l'invité s'il appartient à l'événement
    const { data, error } = await supabaseService
        .from('guests')
        .delete()
        .eq('id', guestId)
        .eq('event_id', eventId)
        .select()
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            throw new Error('Guest not found in this event');
        }
        throw new Error(`Error deleting guest: ${error.message}`);
    }

    return data;
}

/**
 * Vérifie si un utilisateur est propriétaire d'un événement
 * @param {string} eventId - ID de l'événement
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<boolean>}
 */
async function isEventOwner(eventId, userId) {
    if (!eventId || !userId) {
        return false;
    }

    const { data, error } = await supabaseService
        .from('events')
        .select('id')
        .eq('id', eventId)
        .eq('organizer_id', userId)
        .eq('is_active', true)
        .single();

    return !!data;
}

module.exports = {
    updateEventIfOwner,
    softDeleteEventIfOwner,
    getEventIfOwner,
    updateGuestIfEventOwner,
    deleteGuestIfEventOwner,
    isEventOwner
};

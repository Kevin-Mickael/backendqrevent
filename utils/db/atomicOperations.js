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

    console.log('[softDeleteEventIfOwner] Attempting to delete event:', { eventId, userId });

    // First, check if the event exists and get its current state
    const { data: existingEvents, error: fetchError } = await supabaseService
        .from('events')
        .select('id, organizer_id, is_active, title')
        .eq('id', eventId)
        .limit(1);

    if (fetchError) {
        console.log('[softDeleteEventIfOwner] Database error fetching event:', { eventId, error: fetchError.message });
        throw new Error('Event not found or you do not have permission to delete it');
    }

    if (!existingEvents || existingEvents.length === 0) {
        console.log('[softDeleteEventIfOwner] Event not found:', { eventId });
        throw new Error('Event not found or you do not have permission to delete it');
    }

    const existingEvent = existingEvents[0];
    console.log('[softDeleteEventIfOwner] Found event:', existingEvent);

    // Compare as strings to handle different UUID formats
    const eventOrganizerId = String(existingEvent.organizer_id).trim();
    const requestUserId = String(userId).trim();
    
    if (eventOrganizerId !== requestUserId) {
        console.log('[softDeleteEventIfOwner] Permission denied - organizer_id mismatch:', {
            eventOrganizerId,
            requestUserId,
            match: eventOrganizerId === requestUserId
        });
        throw new Error('Event not found or you do not have permission to delete it');
    }

    if (!existingEvent.is_active) {
        console.log('[softDeleteEventIfOwner] Event already inactive:', { eventId });
        // Consider this a success since the event is already "deleted"
        return existingEvent;
    }

    // Perform the soft delete
    const { data, error } = await supabaseService
        .from('events')
        .update({ 
            is_active: false, 
            updated_at: new Date().toISOString() 
        })
        .eq('id', eventId)
        .eq('organizer_id', userId)
        .eq('is_active', true)
        .select();

    if (error) {
        console.log('[softDeleteEventIfOwner] Update error:', { error: error.message, code: error.code });
        throw new Error(`Error deleting event: ${error.message}`);
    }

    if (!data || data.length === 0) {
        console.log('[softDeleteEventIfOwner] No rows updated - event may have been modified concurrently');
        throw new Error('Event not found or you do not have permission to delete it');
    }

    console.log('[softDeleteEventIfOwner] Event deleted successfully:', { eventId });
    return data[0];
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

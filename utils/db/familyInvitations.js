const { supabaseService } = require('../../config/supabase');

// Family Invitations database utilities
const familyInvitationDb = {
    // Create a new family invitation
    create: async (invitationData) => {
        const { data, error } = await supabaseService
            .from('family_invitations')
            .insert([invitationData])
            .select()
            .single();

        if (error) {
            throw new Error(`Error creating family invitation: ${error.message}`);
        }

        return data;
    },

    // Find invitation by ID
    findById: async (id) => {
        const { data, error, status } = await supabaseService
            .from('family_invitations')
            .select(`
                *,
                families:family_id (name, members),
                events:event_id (title, date, location)
            `)
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116' || status === 404 || status === 406) {
                return null;
            }
            throw new Error(`Error finding family invitation: ${error.message}`);
        }

        return data;
    },

    // Find invitation by QR code or by invitation ID (fallback)
    findByQRCode: async (qrCode) => {
        // First, try to find by QR code in family_invitations table
        const { data, error, status } = await supabaseService
            .from('family_invitations')
            .select(`
                *,
                families:family_id (name, members),
                events:event_id (title, date, location, settings, banner_image)
            `)
            .eq('qr_code', qrCode)
            .single();

        if (data) {
            return data;
        }

        // If not found in family_invitations, try to find in qr_codes table (for family QR codes)
        if (error && (error.code === 'PGRST116' || status === 404 || status === 406)) {
            console.log(`QR code ${qrCode} not found in family_invitations, checking qr_codes table...`);
            
            const { data: qrData, error: qrError } = await supabaseService
                .from('qr_codes')
                .select(`
                    *,
                    families:family_id (name, members),
                    events:event_id (title, date, location, settings, banner_image)
                `)
                .eq('code', qrCode)
                .eq('is_valid', true)
                .single();

            if (qrData && qrData.family_id) {
                // Convert qr_codes format to family_invitations format for compatibility
                const convertedData = {
                    id: qrData.id,
                    family_id: qrData.family_id,
                    event_id: qrData.event_id,
                    user_id: qrData.generated_by,
                    invited_count: qrData.invited_count || 1,
                    qr_code: qrData.code,
                    qr_expires_at: qrData.expires_at,
                    is_valid: qrData.is_valid,
                    scan_count: qrData.scan_count || 0,
                    created_at: qrData.created_at,
                    families: qrData.families,
                    events: qrData.events,
                    _source_table: 'qr_codes' // Flag to indicate this comes from qr_codes table
                };
                
                console.log(`Found family QR code ${qrCode} in qr_codes table for family ${qrData.family_id}`);
                return convertedData;
            }

            if (qrError && !(qrError.code === 'PGRST116' || qrError.status === 404)) {
                console.error('Error checking qr_codes table:', qrError.message);
            }
        }

        // If still not found, try UUID fallbacks as before
        if (error && (error.code === 'PGRST116' || status === 404 || status === 406)) {
            // Check if qrCode looks like a UUID (invitation ID or event ID)
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(qrCode)) {
                // Try to find by invitation ID first
                const { data: dataById, error: errorById, status: statusById } = await supabaseService
                    .from('family_invitations')
                    .select(`
                        *,
                        families:family_id (name, members),
                        events:event_id (title, date, location, settings, banner_image)
                    `)
                    .eq('id', qrCode)
                    .single();

                if (dataById) {
                    return dataById;
                }

                // If not found by invitation ID, try to find by event ID
                // This supports /invite/{event_id} URLs from the dashboard invitations page
                if (errorById && (errorById.code === 'PGRST116' || statusById === 404 || statusById === 406)) {
                    const { data: dataByEventId, error: errorByEventId } = await supabaseService
                        .from('family_invitations')
                        .select(`
                            *,
                            families:family_id (name, members),
                            events:event_id (title, date, location, settings, banner_image)
                        `)
                        .eq('event_id', qrCode)
                        .eq('is_valid', true)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (dataByEventId) {
                        return dataByEventId;
                    }

                    if (errorByEventId) {
                        console.error('Error finding invitation by event ID:', errorByEventId.message);
                    }
                }

                if (errorById && !(errorById.code === 'PGRST116' || statusById === 404 || statusById === 406)) {
                    throw new Error(`Error finding invitation by ID: ${errorById.message}`);
                }
            }
            return null;
        }

        if (error) {
            throw new Error(`Error finding invitation by QR: ${error.message}`);
        }

        return data;
    },

    // Find invitations by event ID
    findByEvent: async (eventId) => {
        const { data, error } = await supabaseService
            .from('family_invitations')
            .select(`
                *,
                families:family_id (name, members)
            `)
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });

        if (error) {
            throw new Error(`Error finding invitations: ${error.message}`);
        }

        return data;
    },

    // Find invitations by family ID
    findByFamily: async (familyId) => {
        const { data, error } = await supabaseService
            .from('family_invitations')
            .select(`
                *,
                events:event_id (title, date)
            `)
            .eq('family_id', familyId)
            .order('created_at', { ascending: false });

        if (error) {
            throw new Error(`Error finding invitations: ${error.message}`);
        }

        return data;
    },

    // Update invitation (e.g., increment scan count)
    update: async (id, invitationData) => {
        const { data, error } = await supabaseService
            .from('family_invitations')
            .update(invitationData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new Error(`Error updating invitation: ${error.message}`);
        }

        return data;
    },

    // Increment scan count (works for both family_invitations and qr_codes)
    incrementScan: async (id, table = null) => {
        // If table is explicitly specified as 'qr_codes', increment in qr_codes table
        if (table === 'qr_codes') {
            const { data, error } = await supabaseService
                .from('qr_codes')
                .update({
                    scan_count: 1, // Simple increment since we don't have RPC for qr_codes
                    last_scanned_at: new Date().toISOString()
                })
                .eq('id', id)
                .select()
                .single();

            if (error) {
                // Fallback: get current count and increment manually
                const { data: currentData } = await supabaseService
                    .from('qr_codes')
                    .select('scan_count')
                    .eq('id', id)
                    .single();

                const currentCount = currentData?.scan_count || 0;
                return await supabaseService
                    .from('qr_codes')
                    .update({
                        scan_count: currentCount + 1,
                        last_scanned_at: new Date().toISOString()
                    })
                    .eq('id', id)
                    .select()
                    .single();
            }

            return data;
        }

        // Default: try family_invitations first
        const { data, error } = await supabaseService
            .from('family_invitations')
            .update({
                scan_count: 1, // Simple increment
                last_scanned_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            // If error in family_invitations, check if this is actually a qr_codes ID
            console.log(`ID ${id} not found in family_invitations, checking qr_codes...`);
            
            const { data: qrData, error: qrError } = await supabaseService
                .from('qr_codes')
                .select('scan_count')
                .eq('id', id)
                .single();

            if (qrData) {
                // This is a qr_codes ID, increment there instead
                const currentCount = qrData.scan_count || 0;
                const { data: updatedData } = await supabaseService
                    .from('qr_codes')
                    .update({
                        scan_count: currentCount + 1,
                        last_scanned_at: new Date().toISOString()
                    })
                    .eq('id', id)
                    .select()
                    .single();
                
                return updatedData;
            }

            // Fallback: manual increment for family_invitations
            const invitation = await familyInvitationDb.findById(id);
            if (invitation) {
                return await familyInvitationDb.update(id, {
                    scan_count: (invitation.scan_count || 0) + 1,
                    last_scanned_at: new Date().toISOString()
                });
            }
            throw new Error(`Error incrementing scan count: ${error.message}`);
        }

        return data;
    },

    // Delete invitation
    delete: async (id) => {
        const { data, error } = await supabaseService
            .from('family_invitations')
            .delete()
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new Error(`Error deleting invitation: ${error.message}`);
        }

        return data;
    }
};

module.exports = familyInvitationDb;

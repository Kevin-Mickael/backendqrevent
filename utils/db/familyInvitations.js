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

    // Find invitation by QR code
    findByQRCode: async (qrCode) => {
        const { data, error, status } = await supabaseService
            .from('family_invitations')
            .select(`
                *,
                families:family_id (name, members),
                events:event_id (title, date, location, settings)
            `)
            .eq('qr_code', qrCode)
            .single();

        if (error) {
            if (error.code === 'PGRST116' || status === 404 || status === 406) {
                return null;
            }
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

    // Increment scan count
    incrementScan: async (id) => {
        const { data, error } = await supabaseService
            .from('family_invitations')
            .update({
                scan_count: supabaseService.rpc('increment', { row_id: id }),
                last_scanned_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            // Fallback: manual increment
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

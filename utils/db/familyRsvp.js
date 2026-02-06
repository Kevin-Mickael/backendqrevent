const { supabaseService } = require('../../config/supabase');

// Family RSVP database utilities
const familyRsvpDb = {
    // Create a new RSVP response
    create: async (rsvpData) => {
        const { data, error } = await supabaseService
            .from('family_rsvp')
            .insert([{
                ...rsvpData,
                responded_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (error) {
            throw new Error(`Error creating RSVP: ${error.message}`);
        }

        return data;
    },

    // Find RSVP by ID
    findById: async (id) => {
        const { data, error, status } = await supabaseService
            .from('family_rsvp')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116' || status === 404 || status === 406) {
                return null;
            }
            throw new Error(`Error finding RSVP: ${error.message}`);
        }

        return data;
    },

    // Find RSVPs by invitation ID
    findByInvitation: async (invitationId) => {
        const { data, error } = await supabaseService
            .from('family_rsvp')
            .select('*')
            .eq('family_invitation_id', invitationId)
            .order('created_at', { ascending: true });

        if (error) {
            throw new Error(`Error finding RSVPs: ${error.message}`);
        }

        return data;
    },

    // Find RSVP by invitation and member name
    findByInvitationAndMember: async (invitationId, memberName) => {
        const { data, error, status } = await supabaseService
            .from('family_rsvp')
            .select('*')
            .eq('family_invitation_id', invitationId)
            .eq('member_name', memberName)
            .single();

        if (error) {
            if (error.code === 'PGRST116' || status === 404 || status === 406) {
                return null;
            }
            throw new Error(`Error finding RSVP: ${error.message}`);
        }

        return data;
    },

    // Update RSVP response
    update: async (id, rsvpData) => {
        const { data, error } = await supabaseService
            .from('family_rsvp')
            .update({
                ...rsvpData,
                responded_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new Error(`Error updating RSVP: ${error.message}`);
        }

        return data;
    },

    // Create or update RSVP (upsert)
    upsert: async (invitationId, memberName, rsvpData) => {
        // Try to find existing RSVP
        const existing = await familyRsvpDb.findByInvitationAndMember(invitationId, memberName);
        
        if (existing) {
            // Update existing
            return await familyRsvpDb.update(existing.id, rsvpData);
        } else {
            // Create new
            return await familyRsvpDb.create({
                family_invitation_id: invitationId,
                member_name: memberName,
                ...rsvpData
            });
        }
    },

    // Delete RSVP
    delete: async (id) => {
        const { data, error } = await supabaseService
            .from('family_rsvp')
            .delete()
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new Error(`Error deleting RSVP: ${error.message}`);
        }

        return data;
    },

    // Get RSVP stats for an invitation
    getStats: async (invitationId) => {
        const { data, error } = await supabaseService
            .from('family_rsvp')
            .select('will_attend')
            .eq('family_invitation_id', invitationId);

        if (error) {
            throw new Error(`Error getting RSVP stats: ${error.message}`);
        }

        const stats = {
            total: data.length,
            attending: data.filter(r => r.will_attend === true).length,
            notAttending: data.filter(r => r.will_attend === false).length,
            notResponded: data.filter(r => r.will_attend === null).length
        };

        return stats;
    }
};

module.exports = familyRsvpDb;

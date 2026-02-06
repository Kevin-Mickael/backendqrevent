const { supabaseService } = require('../../config/supabase');

// Family database utilities
const familyDb = {
    // Create a new family
    create: async (familyData) => {
        const { data, error } = await supabaseService
            .from('families')
            .insert([familyData])
            .select()
            .single();

        if (error) {
            throw new Error(`Error creating family: ${error.message}`);
        }

        return data;
    },

    // Find family by ID
    findById: async (id) => {
        const { data, error, status } = await supabaseService
            .from('families')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116' || status === 404 || status === 406) {
                return null;
            }
            throw new Error(`Error finding family: ${error.message}`);
        }

        return data;
    },

    // Find families by user ID
    findByUser: async (userId) => {
        const { data, error } = await supabaseService
            .from('families')
            .select('*')
            .eq('user_id', userId)
            .order('name', { ascending: true });

        if (error) {
            throw new Error(`Error finding families: ${error.message}`);
        }

        return data;
    },

    // Update family
    update: async (id, familyData) => {
        const { data, error } = await supabaseService
            .from('families')
            .update(familyData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new Error(`Error updating family: ${error.message}`);
        }

        return data;
    },

    // Delete family
    delete: async (id) => {
        const { data, error } = await supabaseService
            .from('families')
            .delete()
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new Error(`Error deleting family: ${error.message}`);
        }

        return data;
    }
};

module.exports = familyDb;

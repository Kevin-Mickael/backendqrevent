const { supabaseService } = require('../../config/supabase');

// File database utilities
const fileDb = {
  // Create a new file record
  create: async (fileData) => {
    const { data, error } = await supabaseService
      .from('files')
      .insert([fileData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating file record: ${error.message}`);
    }

    return data;
  },

  // Find file by ID
  findById: async (id) => {
    const { data, error, status } = await supabaseService
      .from('files')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        // Cela signifie simplement que le fichier n'existe pas
        return null;
      }
      // Sinon, c'est une vraie erreur technique
      throw new Error(`Error finding file: ${error.message}`);
    }

    return data;
  },

  // Find files by user ID
  findByUserId: async (userId) => {
    const { data, error } = await supabaseService
      .from('files')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding files by user ID: ${error.message}`);
    }

    return data;
  },

  // Find files by user ID and menu
  findByUserAndMenu: async (userId, menu, submenu = null) => {
    let query = supabaseService
      .from('files')
      .select('*')
      .eq('user_id', userId)
      .eq('menu', menu);

    if (submenu) {
      query = query.eq('submenu', submenu);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding files by user and menu: ${error.message}`);
    }

    return data;
  },

  // Find files by folder path
  findByFolderPath: async (folderPath) => {
    const { data, error } = await supabaseService
      .from('files')
      .select('*')
      .eq('folder_path', folderPath)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding files by folder path: ${error.message}`);
    }

    return data;
  },

  // Update file record
  update: async (id, fileData) => {
    const { data, error } = await supabaseService
      .from('files')
      .update(fileData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating file: ${error.message}`);
    }

    return data;
  },

  // Delete file record (soft delete)
  softDelete: async (id) => {
    const { data, error } = await supabaseService
      .from('files')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting file: ${error.message}`);
    }

    return data;
  },

  // Permanently delete file record
  delete: async (id) => {
    const { data, error } = await supabaseService
      .from('files')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error permanently deleting file: ${error.message}`);
    }

    return data;
  }
};

module.exports = fileDb;
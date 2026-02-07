const { supabaseService } = require('../../config/supabase');

/**
 * Event Gallery Database Utilities
 * Handles shared photo/video gallery for events
 */

const eventGalleryDb = {
  /**
   * Create a new gallery item
   */
  create: async (galleryData) => {
    const { data, error } = await supabaseService
      .from('event_gallery')
      .insert([galleryData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating gallery item: ${error.message}`);
    }

    return data;
  },

  /**
   * Find gallery item by ID
   */
  findById: async (id) => {
    const { data, error, status } = await supabaseService
      .from('event_gallery')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        return null;
      }
      throw new Error(`Error finding gallery item: ${error.message}`);
    }

    return data;
  },

  /**
   * Get gallery items by event
   */
  findByEvent: async (eventId, options = {}) => {
    const { fileType, limit = 50, offset = 0, includeUnapproved = false } = options;
    
    let query = supabaseService
      .from('event_gallery')
      .select(`
        *,
        families:family_id (name),
        users:uploaded_by (name, avatar_url)
      `)
      .eq('event_id', eventId)
      .eq('is_deleted', false)
      .order('uploaded_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (fileType) {
      query = query.eq('file_type', fileType);
    }

    if (!includeUnapproved) {
      query = query.eq('is_approved', true);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error fetching gallery: ${error.message}`);
    }

    return data || [];
  },

  /**
   * Get gallery stats for an event
   */
  getStats: async (eventId) => {
    const { data, error } = await supabaseService
      .from('event_gallery_stats')
      .select('*')
      .eq('event_id', eventId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          total_items: 0,
          image_count: 0,
          video_count: 0,
          total_size: 0,
          recent_uploads: 0
        };
      }
      throw new Error(`Error fetching gallery stats: ${error.message}`);
    }

    return data || {
      total_items: 0,
      image_count: 0,
      video_count: 0,
      total_size: 0,
      recent_uploads: 0
    };
  },

  /**
   * Update gallery item
   */
  update: async (id, updateData) => {
    const { data, error } = await supabaseService
      .from('event_gallery')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating gallery item: ${error.message}`);
    }

    return data;
  },

  /**
   * Soft delete gallery item
   */
  softDelete: async (id) => {
    const { data, error } = await supabaseService
      .from('event_gallery')
      .update({ 
        is_deleted: true, 
        deleted_at: new Date().toISOString() 
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting gallery item: ${error.message}`);
    }

    return data;
  },

  /**
   * Approve/reject gallery item
   */
  setApproval: async (id, isApproved) => {
    const { data, error } = await supabaseService
      .from('event_gallery')
      .update({ is_approved: isApproved })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating approval: ${error.message}`);
    }

    return data;
  },

  /**
   * Set featured status
   */
  setFeatured: async (id, isFeatured) => {
    const { data, error } = await supabaseService
      .from('event_gallery')
      .update({ is_featured: isFeatured })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating featured status: ${error.message}`);
    }

    return data;
  },

  /**
   * Get recent uploads for an event
   */
  getRecentUploads: async (eventId, limit = 10) => {
    const { data, error } = await supabaseService
      .from('event_gallery')
      .select(`
        *,
        families:family_id (name),
        users:uploaded_by (name, avatar_url)
      `)
      .eq('event_id', eventId)
      .eq('is_deleted', false)
      .eq('is_approved', true)
      .order('uploaded_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Error fetching recent uploads: ${error.message}`);
    }

    return data || [];
  }
};

module.exports = eventGalleryDb;

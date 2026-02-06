const { supabaseService } = require('../../config/supabase');

// Feedback database utilities
const feedbackDb = {
  // ==================== FEEDBACK CRUD ====================

  // Create a new feedback
  create: async (feedbackData) => {
    const { data, error } = await supabaseService
      .from('feedbacks')
      .insert([feedbackData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating feedback: ${error.message}`);
    }

    return data;
  },

  // Find feedback by ID
  findById: async (id) => {
    const { data, error, status } = await supabaseService
      .from('feedbacks')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        return null;
      }
      throw new Error(`Error finding feedback: ${error.message}`);
    }

    return data;
  },

  // Find all feedbacks by event ID
  findByEvent: async (eventId, options = {}) => {
    const { 
      feedbackType = null, 
      isApproved = null, 
      limit = 100, 
      offset = 0,
      orderBy = 'created_at',
      orderDesc = true
    } = options;

    let query = supabaseService
      .from('feedbacks')
      .select('*')
      .eq('event_id', eventId)
      .eq('is_active', true);

    if (feedbackType) {
      query = query.eq('feedback_type', feedbackType);
    }

    if (isApproved !== null) {
      query = query.eq('is_approved', isApproved);
    }

    query = query
      .order(orderBy, { ascending: !orderDesc })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding feedbacks: ${error.message}`);
    }

    return data || [];
  },

  // Find feedbacks by family ID
  findByFamily: async (familyId) => {
    const { data, error } = await supabaseService
      .from('feedbacks')
      .select('*')
      .eq('family_id', familyId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding feedbacks by family: ${error.message}`);
    }

    return data || [];
  },

  // Update feedback
  update: async (id, feedbackData) => {
    const { data, error } = await supabaseService
      .from('feedbacks')
      .update({ ...feedbackData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating feedback: ${error.message}`);
    }

    return data;
  },

  // Soft delete feedback
  softDelete: async (id) => {
    const { data, error } = await supabaseService
      .from('feedbacks')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting feedback: ${error.message}`);
    }

    return data;
  },

  // Hard delete feedback (admin only)
  hardDelete: async (id) => {
    const { error } = await supabaseService
      .from('feedbacks')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Error permanently deleting feedback: ${error.message}`);
    }

    return true;
  },

  // ==================== MODERATION ====================

  // Approve feedback
  approve: async (id) => {
    const { data, error } = await supabaseService
      .from('feedbacks')
      .update({ is_approved: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error approving feedback: ${error.message}`);
    }

    return data;
  },

  // Reject/unapprove feedback
  unapprove: async (id) => {
    const { data, error } = await supabaseService
      .from('feedbacks')
      .update({ is_approved: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error unapproving feedback: ${error.message}`);
    }

    return data;
  },

  // Mark as featured
  setFeatured: async (id, featured = true) => {
    const { data, error } = await supabaseService
      .from('feedbacks')
      .update({ is_featured: featured, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error setting feedback featured status: ${error.message}`);
    }

    return data;
  },

  // ==================== STATISTICS ====================

  // Get feedback statistics for an event
  getStats: async (eventId) => {
    const { data, error } = await supabaseService
      .from('feedback_stats')
      .select('*')
      .eq('event_id', eventId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No feedbacks yet, return default stats
        return {
          event_id: eventId,
          total_feedbacks: 0,
          total_wishes: 0,
          total_guestbook: 0,
          approved_count: 0,
          pending_count: 0,
          average_rating: null,
          five_star_count: 0,
          last_feedback_date: null
        };
      }
      throw new Error(`Error getting feedback stats: ${error.message}`);
    }

    return data;
  },

  // Get rating distribution for an event
  getRatingDistribution: async (eventId) => {
    const { data, error } = await supabaseService
      .from('feedbacks')
      .select('rating')
      .eq('event_id', eventId)
      .eq('is_active', true)
      .not('rating', 'is', null);

    if (error) {
      throw new Error(`Error getting rating distribution: ${error.message}`);
    }

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    data?.forEach(item => {
      if (item.rating >= 1 && item.rating <= 5) {
        distribution[item.rating]++;
      }
    });

    return distribution;
  },

  // Get recent feedbacks
  getRecent: async (eventId, limit = 5) => {
    const { data, error } = await supabaseService
      .from('feedbacks')
      .select('*')
      .eq('event_id', eventId)
      .eq('is_active', true)
      .eq('is_approved', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Error getting recent feedbacks: ${error.message}`);
    }

    return data || [];
  },

  // Search feedbacks
  search: async (eventId, searchTerm, options = {}) => {
    const { limit = 50, offset = 0 } = options;

    const { data, error } = await supabaseService
      .from('feedbacks')
      .select('*')
      .eq('event_id', eventId)
      .eq('is_active', true)
      .or(`author_name.ilike.%${searchTerm}%,message.ilike.%${searchTerm}%`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Error searching feedbacks: ${error.message}`);
    }

    return data || [];
  },

  // Check if family/guest has already submitted feedback
  hasSubmitted: async (eventId, identifier) => {
    let query = supabaseService
      .from('feedbacks')
      .select('id')
      .eq('event_id', eventId)
      .eq('is_active', true);

    if (identifier.familyId) {
      query = query.eq('family_id', identifier.familyId);
    } else if (identifier.guestId) {
      query = query.eq('guest_id', identifier.guestId);
    } else if (identifier.email) {
      query = query.eq('author_email', identifier.email.toLowerCase());
    } else {
      return false;
    }

    const { data, error } = await query.limit(1);

    if (error) {
      throw new Error(`Error checking feedback submission: ${error.message}`);
    }

    return data && data.length > 0;
  }
};

module.exports = feedbackDb;

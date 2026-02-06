const { supabaseService } = require('../../config/supabase');

// Attendance database utilities
const attendanceDb = {
  // Create a new attendance record
  create: async (attendanceData) => {
    const { data, error } = await supabaseService
      .from('attendance')
      .insert([attendanceData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating attendance: ${error.message}`);
    }

    return data;
  },

  // Find attendance by event and guest
  findByEventAndGuest: async (eventId, guestId) => {
    const { data, error } = await supabaseService
      .from('attendance')
      .select('*')
      .eq('event_id', eventId)
      .eq('guest_id', guestId)
      .order('timestamp', { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(`Error finding attendance: ${error.message}`);
    }

    return data;
  },

  // Find attendances by event
  findByEvent: async (eventId) => {
    const { data, error } = await supabaseService
      .from('attendance')
      .select(`
        *,
        guests (first_name, last_name, email)
      `)
      .eq('event_id', eventId)
      .order('timestamp', { ascending: false });

    if (error) {
      throw new Error(`Error finding attendances: ${error.message}`);
    }

    return data;
  }
};

module.exports = attendanceDb;
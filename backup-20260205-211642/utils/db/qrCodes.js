const { supabaseService } = require('../../config/supabase');

// QR Code database utilities
const qrCodeDb = {
  // Create a new QR code
  create: async (qrCodeData) => {
    const { data, error } = await supabaseService
      .from('qr_codes')
      .insert([qrCodeData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating QR code: ${error.message}`);
    }

    return data;
  },

  // Find QR code by code
  findByCode: async (code) => {
    const { data, error, status } = await supabaseService
      .from('qr_codes')
      .select(`
        *,
        guests (*),
        events (*)
      `)
      .eq('code', code)
      .eq('is_valid', true)
      .gte('expires_at', new Date().toISOString())
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        // Cela signifie simplement que le QR code n'existe pas
        return null;
      }
      // Sinon, c'est une vraie erreur technique
      throw new Error(`Error finding QR code: ${error.message}`);
    }

    return data;
  },

  // Find QR code by guest ID
  findByGuestId: async (guestId) => {
    const { data, error, status } = await supabaseService
      .from('qr_codes')
      .select('*')
      .eq('guest_id', guestId)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || status === 404 || status === 406) {
        // Cela signifie simplement que le QR code n'existe pas
        return null;
      }
      // Sinon, c'est une vraie erreur technique
      throw new Error(`Error finding QR code by guest ID: ${error.message}`);
    }

    return data;
  },

  // Update QR code (e.g., increment scan count)
  update: async (id, qrCodeData) => {
    const { data, error } = await supabaseService
      .from('qr_codes')
      .update(qrCodeData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating QR code: ${error.message}`);
    }

    return data;
  },

  // Invalidate QR code
  invalidate: async (id) => {
    const { data, error } = await supabaseService
      .from('qr_codes')
      .update({ is_valid: false })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error invalidating QR code: ${error.message}`);
    }

    return data;
  }
};

module.exports = qrCodeDb;
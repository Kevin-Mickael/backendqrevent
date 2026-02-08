const { supabaseService } = require('../../config/supabase');

// Default menu settings structure
const defaultMenuSettings = {
  message: true,
  histoire: true,
  invitation: true,
  table: false,
  game: true,
  avis: true,
  menu_type: 'manual',
  menu_file_url: null,
  menu_items: []
};

/**
 * Menu database utilities
 * Handles menu settings for events
 */
const menuDb = {
  /**
   * Get menu settings for an event
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Menu settings
   */
  getSettings: async (eventId) => {
    const { data, error } = await supabaseService
      .from('events')
      .select('menu_settings')
      .eq('id', eventId)
      .single();

    if (error) {
      throw new Error(`Error fetching menu settings: ${error.message}`);
    }

    // Merge with defaults to ensure all fields exist
    return { ...defaultMenuSettings, ...(data?.menu_settings || {}) };
  },

  /**
   * Update menu settings for an event
   * @param {string} eventId - Event ID
   * @param {Object} settings - New menu settings (partial)
   * @returns {Promise<Object>} Updated menu settings
   */
  updateSettings: async (eventId, settings) => {
    // First get current settings
    const { data: currentData, error: fetchError } = await supabaseService
      .from('events')
      .select('menu_settings')
      .eq('id', eventId)
      .single();

    if (fetchError) {
      throw new Error(`Error fetching current menu settings: ${fetchError.message}`);
    }

    // Merge settings
    const currentSettings = currentData?.menu_settings || defaultMenuSettings;
    const newSettings = { ...currentSettings, ...settings };

    // Update
    const { data, error } = await supabaseService
      .from('events')
      .update({ menu_settings: newSettings })
      .eq('id', eventId)
      .select('menu_settings')
      .single();

    if (error) {
      throw new Error(`Error updating menu settings: ${error.message}`);
    }

    return data?.menu_settings || newSettings;
  },

  /**
   * Upload a menu file and update settings
   * @param {string} eventId - Event ID
   * @param {string} fileUrl - URL of the uploaded file
   * @returns {Promise<Object>} Updated menu settings
   */
  setMenuFile: async (eventId, fileUrl) => {
    return menuDb.updateSettings(eventId, {
      menu_file_url: fileUrl,
      menu_type: 'file'
    });
  },

  /**
   * Remove menu file and switch to manual mode
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} Updated menu settings
   */
  removeMenuFile: async (eventId) => {
    return menuDb.updateSettings(eventId, {
      menu_file_url: null,
      menu_type: 'manual'
    });
  },

  /**
   * Set menu items (for manual mode)
   * @param {string} eventId - Event ID
   * @param {Array} menuItems - Array of menu items
   * @returns {Promise<Object>} Updated menu settings
   */
  setMenuItems: async (eventId, menuItems) => {
    return menuDb.updateSettings(eventId, {
      menu_items: menuItems,
      menu_type: 'manual'
    });
  },

  /**
   * Toggle a menu section
   * @param {string} eventId - Event ID
   * @param {string} section - Section name (message, histoire, invitation, table, game, avis)
   * @param {boolean} enabled - Whether to enable or disable
   * @returns {Promise<Object>} Updated menu settings
   */
  toggleSection: async (eventId, section, enabled) => {
    const validSections = ['message', 'histoire', 'invitation', 'table', 'game', 'avis'];
    if (!validSections.includes(section)) {
      throw new Error(`Invalid menu section: ${section}`);
    }

    const update = { [section]: enabled };
    return menuDb.updateSettings(eventId, update);
  },

  /**
   * Get default menu settings
   * @returns {Object} Default menu settings
   */
  getDefaultSettings: () => {
    return { ...defaultMenuSettings };
  },

  /**
   * Validate menu settings structure
   * @param {Object} settings - Settings to validate
   * @returns {Object} Validated settings merged with defaults
   */
  validateSettings: (settings) => {
    if (!settings || typeof settings !== 'object') {
      return { ...defaultMenuSettings };
    }

    return {
      ...defaultMenuSettings,
      ...settings,
      // Ensure menu_items is always an array
      menu_items: Array.isArray(settings.menu_items) ? settings.menu_items : []
    };
  }
};

module.exports = menuDb;

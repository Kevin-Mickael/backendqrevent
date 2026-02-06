/**
 * Database Schema Validator Service
 * 
 * Validates that the database schema matches the expected structure.
 * Runs on application startup to detect migration issues early.
 * 
 * @module services/databaseValidator
 */

const { supabaseService } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Expected schema definition for validation
 */
const EXPECTED_SCHEMA = {
  users: {
    requiredColumns: [
      'id',
      'name',
      'email',
      'password_hash',
      'role',
      'is_active',
      'created_at',
      'updated_at',
      'avatar_url',  // Added for avatar support
      'preferences'
    ]
  },
  events: {
    requiredColumns: [
      'id',
      'organizer_id',
      'title',
      'description',
      'date',
      'location',
      'cover_image',
      'banner_image',
      'settings',
      'is_active',
      'created_at',
      'updated_at'
    ]
  }
};

/**
 * Check if all required columns exist in the database
 * @returns {Promise<{valid: boolean, missing: Object, errors: string[]}>}
 */
const validateSchema = async () => {
  const errors = [];
  const missing = {};

  try {
    logger.info('Starting database schema validation...');

    for (const [tableName, tableSchema] of Object.entries(EXPECTED_SCHEMA)) {
      // Get existing columns for this table
      const { data: columns, error } = await supabaseService
        .from('information_schema.columns')
        .select('column_name')
        .eq('table_schema', 'public')
        .eq('table_name', tableName);

      if (error) {
        errors.push(`Failed to query columns for table ${tableName}: ${error.message}`);
        continue;
      }

      const existingColumns = columns.map(col => col.column_name);
      const missingColumns = tableSchema.requiredColumns.filter(
        col => !existingColumns.includes(col)
      );

      if (missingColumns.length > 0) {
        missing[tableName] = missingColumns;
        errors.push(
          `Table '${tableName}' is missing columns: ${missingColumns.join(', ')}`
        );
      }
    }

    const isValid = errors.length === 0;

    if (isValid) {
      logger.info('✅ Database schema validation passed');
    } else {
      logger.error('❌ Database schema validation failed:', { errors, missing });
    }

    return { valid: isValid, missing, errors };

  } catch (error) {
    logger.error('Critical error during schema validation:', {
      error: error.message,
      stack: error.stack
    });
    return { valid: false, missing: {}, errors: [error.message] };
  }
};

/**
 * Check specifically for avatar support
 * @returns {Promise<boolean>}
 */
const hasAvatarSupport = async () => {
  try {
    const { data, error } = await supabaseService
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'users')
      .eq('column_name', 'avatar_url')
      .single();

    if (error || !data) {
      logger.warn('Avatar support not detected: avatar_url column missing in users table');
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error checking avatar support:', error.message);
    return false;
  }
};

module.exports = {
  validateSchema,
  hasAvatarSupport,
  EXPECTED_SCHEMA
};

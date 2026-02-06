/**
 * Script de vérification de la base de données
 * Vérifie que toutes les tables nécessaires existent
 */
const { supabaseService } = require('../config/supabase');
const logger = require('./logger');

const requiredTables = [
  'users',
  'events',
  'guests',
  'qr_codes',
  'attendance',
  'families',
  'family_invitations',
  'family_rsvp',
  'story_events',
  'games',
  'game_questions',
  'game_participations',
  'feedbacks'  // Nouvelle table pour les avis
];

async function checkTableExists(tableName) {
  try {
    const { data, error } = await supabaseService
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_name', tableName)
      .single();

    if (error && error.code === 'PGRST116') {
      return false;
    }
    
    if (error) {
      throw error;
    }

    return !!data;
  } catch (error) {
    logger.error(`Error checking table ${tableName}:`, error.message);
    return false;
  }
}

async function checkDatabase() {
  logger.info('Checking database tables...');
  
  const missingTables = [];
  
  for (const table of requiredTables) {
    const exists = await checkTableExists(table);
    if (!exists) {
      missingTables.push(table);
      logger.warn(`❌ Table missing: ${table}`);
    } else {
      logger.info(`✅ Table exists: ${table}`);
    }
  }

  if (missingTables.length > 0) {
    logger.error('Missing tables detected:', missingTables);
    logger.error('Please run the following migrations:');
    
    if (missingTables.includes('feedbacks')) {
      logger.error('  - backend/migrations/009_add_feedback_table.sql');
    }
    
    return false;
  }

  logger.info('✅ All required tables exist');
  return true;
}

// Run if called directly
if (require.main === module) {
  checkDatabase()
    .then(ok => {
      process.exit(ok ? 0 : 1);
    })
    .catch(error => {
      logger.error('Database check failed:', error);
      process.exit(1);
    });
}

module.exports = { checkDatabase };

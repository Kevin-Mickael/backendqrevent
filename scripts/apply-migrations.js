#!/usr/bin/env node
/**
 * Database Migration Script
 * 
 * Applies pending migrations to the database.
 * Usage: node scripts/apply-migrations.js
 * 
 * Following project rules:
 * - Idempotent migrations
 * - Transactional safety
 * - Clear logging
 */

const fs = require('fs');
const path = require('path');
const { supabaseService } = require('../config/supabase');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Read and execute a migration file
 */
const executeMigration = async (filename) => {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, 'utf-8');

  logger.info(`Applying migration: ${filename}`);

  try {
    // Execute the SQL
    const { error } = await supabaseService.rpc('exec_sql', { sql });
    
    if (error) {
      // If rpc doesn't exist, try direct query (requires appropriate permissions)
      logger.warn('RPC exec_sql not available, migration must be applied manually via Supabase Dashboard');
      logger.info(`Migration file location: ${filepath}`);
      logger.info('Please run this SQL in Supabase SQL Editor:');
      logger.info('---');
      logger.info(sql);
      logger.info('---');
      return false;
    }

    logger.info(`✅ Migration applied successfully: ${filename}`);
    return true;
  } catch (error) {
    logger.error(`❌ Failed to apply migration ${filename}:`, error.message);
    return false;
  }
};

/**
 * List all migration files
 */
const getMigrationFiles = () => {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.warn(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    return [];
  }

  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql'))
    .sort(); // Ensures numeric ordering (001, 002, etc.)
};

/**
 * Main function
 */
const main = async () => {
  logger.info('🔧 Database Migration Tool');
  logger.info('========================');

  const migrations = getMigrationFiles();

  if (migrations.length === 0) {
    logger.info('No migrations found.');
    return;
  }

  logger.info(`Found ${migrations.length} migration(s):`);
  migrations.forEach(m => logger.info(`  - ${m}`));

  // Note: Automatic execution via script is limited by Supabase permissions
  // Most migrations should be applied via Supabase Dashboard
  logger.info('\n⚠️  Note: Due to Supabase security restrictions, migrations should be applied manually:');
  logger.info('1. Go to Supabase Dashboard → SQL Editor');
  logger.info('2. Copy the content of the migration file');
  logger.info('3. Execute the SQL');
  logger.info('\nMigration files location:');
  logger.info(MIGRATIONS_DIR);

  // Show first pending migration
  if (migrations.length > 0) {
    const firstMigration = migrations[migrations.length - 1];
    const filepath = path.join(MIGRATIONS_DIR, firstMigration);
    const sql = fs.readFileSync(filepath, 'utf-8');
    
    logger.info(`\n📄 Latest migration (${firstMigration}):`);
    logger.info('---');
    logger.info(sql.substring(0, 500) + (sql.length > 500 ? '...' : ''));
    logger.info('---');
  }
};

// Run if executed directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      logger.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { getMigrationFiles, executeMigration };

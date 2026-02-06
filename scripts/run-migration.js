#!/usr/bin/env node
/**
 * Database Migration Script
 * 
 * Applies pending migrations to the database using PostgreSQL connection.
 * Usage: node scripts/run-migration.js
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * Read and execute a migration file
 */
const executeMigration = async (filename) => {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, 'utf-8');

  logger.info(`Applying migration: ${filename}`);

  // Get connection string from environment
  const connectionString = process.env.SUPABASE_CONNECTION_STRING;
  
  if (!connectionString) {
    logger.error('❌ SUPABASE_CONNECTION_STRING not found in environment!');
    return false;
  }

  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    logger.info('✅ Connected to database');

    // Execute the entire SQL as a single transaction
    // This properly handles PL/pgSQL functions with semicolons inside
    try {
      await client.query(sql);
    } catch (error) {
      // Ignore "already exists" errors for tables, indexes, etc.
      if (error.message.includes('already exists') || 
          error.message.includes('duplicate key') ||
          error.code === '42P07' || // duplicate_table
          error.code === '42710') { // duplicate_object
        logger.info(`  ⚠️  Some objects already exist, continuing...`);
      } else {
        throw error;
      }
    }

    logger.info(`✅ Migration applied successfully: ${filename}`);
    return true;
  } catch (error) {
    logger.error(`❌ Failed to apply migration ${filename}:`, error.message);
    return false;
  } finally {
    await client.end();
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

  // Apply the latest migration (005_add_story_events_table.sql)
  const targetMigration = process.argv[2] || '005_add_story_events_table.sql';
  
  if (!migrations.includes(targetMigration)) {
    logger.error(`Migration ${targetMigration} not found!`);
    logger.info('Available migrations:');
    migrations.forEach(m => logger.info(`  - ${m}`));
    process.exit(1);
  }

  // Read the migration file
  const filepath = path.join(MIGRATIONS_DIR, targetMigration);
  const sql = fs.readFileSync(filepath, 'utf-8');
  
  logger.info(`\n📄 Migration to apply (${targetMigration}):`);
  logger.info('---');
  logger.info(sql);
  logger.info('---');

  // Try to execute via exec_sql RPC
  logger.info('\n🚀 Attempting to execute migration...');
  
  const success = await executeMigration(targetMigration);
  
  if (!success) {
    logger.info('\n⚠️  Automatic migration failed.');
    logger.info('Please apply the migration manually via Supabase Dashboard:');
    logger.info('1. Go to https://app.supabase.com');
    logger.info('2. Select your project');
    logger.info('3. Go to SQL Editor');
    logger.info('4. Copy and paste the SQL above');
    logger.info('5. Click "Run"');
    process.exit(1);
  }

  logger.info('\n✅ All done!');
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

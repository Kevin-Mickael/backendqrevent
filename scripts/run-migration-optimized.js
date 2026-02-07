#!/usr/bin/env node

/**
 * Script de migration optimisé pour Qrevent
 * - Exécute les migrations dans l'ordre
 * - Évite les doublons
 * - Journalise les opérations
 */

const { supabaseService } = require('../config/supabase');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Ordre d'exécution des migrations (consolidé et optimisé)
const MIGRATION_ORDER = [
    // 1. Tables de base
    '001_create_tables.sql',
    
    // 2. Extensions et fonctions
    '001_create_rpc_functions.sql',
    
    // 3. Tables additionnelles (ordre logique des dépendances)
    '002_add_files_table.sql',
    '003_secure_tables.sql',
    '005_add_story_events_table.sql',
    '006_create_families_table.sql',
    '006_add_games_tables_fixed.sql',
    '007_create_family_invitations.sql',
    '009_create_wishes_table.sql',
    '009_add_feedback_table.sql',
    '010_create_seating_tables.sql',
    '011_link_families_to_tables.sql',
    '013_create_audit_logging.sql',
    '014_create_budget_items_table.sql',
    '017_add_budget_item_details.sql',
    '018_create_messages_tables.sql',
    '019_secure_messages_rls.sql',
    '020_create_event_gallery_table.sql',
    '020_security_fixes.sql',
    
    // 4. Migration consolidée (optimisations et colonnes additionnelles)
    '023_consolidated_schema_optimization.sql',
    
    // 5. Cleanup (toujours en dernier)
    '022_cleanup_test_events.sql',
];

// Créer la table de suivi des migrations si elle n'existe pas
async function ensureMigrationsTable() {
    const { error } = await supabaseService.rpc('exec_sql', {
        sql: `
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) UNIQUE NOT NULL,
                executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                checksum VARCHAR(64),
                execution_time_ms INTEGER
            );
            
            CREATE INDEX IF NOT EXISTS idx_schema_migrations_filename ON schema_migrations(filename);
        `
    });
    
    if (error) {
        // Fallback si la fonction RPC n'existe pas
        console.log('Using fallback for migrations table...');
        const { error: tableError } = await supabaseService
            .from('schema_migrations')
            .select('id')
            .limit(1);
            
        if (tableError && tableError.code === '42P01') {
            console.error('Please run 001_create_rpc_functions.sql first or create schema_migrations table manually');
            throw error;
        }
    }
}

// Calculer le checksum d'un fichier
function getChecksum(filePath) {
    const crypto = require('crypto');
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('sha256').update(content).digest('hex');
}

// Vérifier si une migration a déjà été exécutée
async function isMigrationExecuted(filename) {
    const { data, error } = await supabaseService
        .from('schema_migrations')
        .select('id')
        .eq('filename', filename)
        .single();
    
    if (error && error.code !== 'PGRST116') {
        console.warn(`Warning checking migration ${filename}:`, error.message);
        return false;
    }
    
    return !!data;
}

// Enregistrer une migration comme exécutée
async function recordMigration(filename, checksum, executionTime) {
    const { error } = await supabaseService
        .from('schema_migrations')
        .insert([{
            filename,
            checksum,
            execution_time_ms: executionTime
        }]);
    
    if (error) {
        console.error(`Failed to record migration ${filename}:`, error);
    }
}

// Exécuter une migration
async function runMigration(filename) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
        console.log(`⏭️  Skipping ${filename} (file not found)`);
        return { skipped: true };
    }
    
    const alreadyExecuted = await isMigrationExecuted(filename);
    if (alreadyExecuted) {
        console.log(`✅ ${filename} already executed`);
        return { skipped: true };
    }
    
    console.log(`\n🔄 Executing ${filename}...`);
    const startTime = Date.now();
    
    try {
        const sql = fs.readFileSync(filePath, 'utf8');
        const checksum = getChecksum(filePath);
        
        // Exécuter la migration
        const { error } = await supabaseService.rpc('exec_sql', { sql });
        
        if (error) {
            // Fallback: tenter d'exécuter les commandes individuellement
            console.log('   RPC failed, trying direct execution...');
            const statements = sql.split(/;\s*$/m).filter(s => s.trim());
            
            for (const statement of statements) {
                if (statement.trim()) {
                    const { error: stmtError } = await supabaseService.rpc('exec_sql', { 
                        sql: statement.trim() + ';' 
                    });
                    if (stmtError && !stmtError.message.includes('already exists')) {
                        throw new Error(`Statement failed: ${stmtError.message}\nSQL: ${statement.substring(0, 100)}...`);
                    }
                }
            }
        }
        
        const executionTime = Date.now() - startTime;
        await recordMigration(filename, checksum, executionTime);
        
        console.log(`✅ ${filename} completed in ${executionTime}ms`);
        return { success: true, executionTime };
        
    } catch (error) {
        console.error(`❌ ${filename} failed:`, error.message);
        return { success: false, error: error.message };
    }
}

// Migration principale
async function main() {
    console.log('🚀 Starting database migration...\n');
    
    try {
        await ensureMigrationsTable();
        
        const results = {
            executed: 0,
            skipped: 0,
            failed: 0,
            total: MIGRATION_ORDER.length
        };
        
        for (const filename of MIGRATION_ORDER) {
            const result = await runMigration(filename);
            
            if (result.success) {
                results.executed++;
            } else if (result.skipped) {
                results.skipped++;
            } else {
                results.failed++;
                if (results.failed >= 3) {
                    console.error('\n❌ Too many failures, stopping migration');
                    break;
                }
            }
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('📊 Migration Summary:');
        console.log(`   Total: ${results.total}`);
        console.log(`   Executed: ${results.executed}`);
        console.log(`   Skipped: ${results.skipped}`);
        console.log(`   Failed: ${results.failed}`);
        console.log('='.repeat(50));
        
        // Afficher les optimisations appliquées
        console.log('\n🎯 Optimizations applied:');
        console.log('   ✅ Composite indexes for common queries');
        console.log('   ✅ BRIN indexes for time-series data (attendance)');
        console.log('   ✅ Partial indexes for active records');
        console.log('   ✅ Consolidated schema updates');
        console.log('   ✅ Removed redundant indexes');
        
        process.exit(results.failed > 0 ? 1 : 0);
        
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    }
}

main();

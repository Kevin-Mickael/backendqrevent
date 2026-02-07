#!/usr/bin/env node

/**
 * Analyse les migrations pour identifier les redondances
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Patterns à rechercher
const COLUMN_ADDITIONS = /ADD COLUMN (?:IF NOT EXISTS )?(\w+)/gi;
const TABLE_CREATIONS = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)/gi;
const INDEX_CREATIONS = /CREATE INDEX (?:IF NOT EXISTS )?(\w+)/gi;

function analyzeMigrations() {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
    
    const columnsAdded = new Map();
    const tablesCreated = new Map();
    const indexesCreated = new Map();
    
    const analysis = {
        totalFiles: files.length,
        redundantColumns: [],
        redundantTables: [],
        redundantIndexes: [],
        recommendations: []
    };
    
    for (const file of files) {
        const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        
        // Chercher les colonnes ajoutées
        let match;
        while ((match = COLUMN_ADDITIONS.exec(content)) !== null) {
            const col = match[1];
            if (columnsAdded.has(col)) {
                analysis.redundantColumns.push({
                    column: col,
                    previousFile: columnsAdded.get(col),
                    redundantFile: file
                });
            } else {
                columnsAdded.set(col, file);
            }
        }
        
        // Chercher les tables créées
        while ((match = TABLE_CREATIONS.exec(content)) !== null) {
            const tbl = match[1];
            if (tablesCreated.has(tbl)) {
                analysis.redundantTables.push({
                    table: tbl,
                    previousFile: tablesCreated.get(tbl),
                    redundantFile: file
                });
            } else {
                tablesCreated.set(tbl, file);
            }
        }
        
        // Chercher les index créés
        while ((match = INDEX_CREATIONS.exec(content)) !== null) {
            const idx = match[1];
            if (indexesCreated.has(idx)) {
                analysis.redundantIndexes.push({
                    index: idx,
                    previousFile: indexesCreated.get(idx),
                    redundantFile: file
                });
            } else {
                indexesCreated.set(idx, file);
            }
        }
    }
    
    // Générer des recommandations
    if (analysis.redundantColumns.length > 0) {
        analysis.recommendations.push({
            type: 'REDUNDANT_COLUMNS',
            message: `${analysis.redundantColumns.length} colonnes redondantes détectées`,
            action: 'Consolider dans une seule migration'
        });
    }
    
    // Identifier les fichiers obsolètes
    const obsoleteFiles = [
        'add_avatar_url.sql', // Non numéroté, redondant
    ];
    
    analysis.recommendations.push({
        type: 'OBSOLETE_FILES',
        message: `${obsoleteFiles.length} fichiers obsolètes identifiés`,
        files: obsoleteFiles,
        action: 'Supprimer ou archiver'
    });
    
    return analysis;
}

function printAnalysis(analysis) {
    console.log('\n📊 MIGRATION ANALYSIS\n');
    console.log('=' .repeat(50));
    
    console.log(`\n📁 Total files: ${analysis.totalFiles}`);
    
    console.log('\n🔴 Redundant Columns:');
    if (analysis.redundantColumns.length === 0) {
        console.log('   None found ✅');
    } else {
        analysis.redundantColumns.forEach(r => {
            console.log(`   ⚠️  ${r.column}: ${r.previousFile} → ${r.redundantFile}`);
        });
    }
    
    console.log('\n🔴 Redundant Tables:');
    if (analysis.redundantTables.length === 0) {
        console.log('   None found ✅');
    } else {
        analysis.redundantTables.forEach(r => {
            console.log(`   ⚠️  ${r.table}: ${r.previousFile} → ${r.redundantFile}`);
        });
    }
    
    console.log('\n💡 Recommendations:');
    analysis.recommendations.forEach(rec => {
        console.log(`\n   ${rec.type}:`);
        console.log(`   ${rec.message}`);
        console.log(`   Action: ${rec.action}`);
        if (rec.files) {
            console.log(`   Files: ${rec.files.join(', ')}`);
        }
    });
    
    console.log('\n' + '='.repeat(50));
    console.log('\n✨ Proposed Migration Order:');
    console.log('   1. Base tables (001_create_tables.sql)');
    console.log('   2. RPC functions (001_create_rpc_functions.sql)');
    console.log('   3. Feature tables (ordered by dependencies)');
    console.log('   4. Consolidated optimization (023_consolidated_schema_optimization.sql)');
    console.log('   5. Cleanup scripts\n');
}

const analysis = analyzeMigrations();
printAnalysis(analysis);

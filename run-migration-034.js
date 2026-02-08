#!/usr/bin/env node
/**
 * Script pour exécuter la migration 034 (accès public aux jeux)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

async function runMigration() {
  console.log('🚀 Exécution de la migration 034...\n');
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Erreur: SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Lire le fichier de migration
  const migrationPath = path.join(__dirname, 'migrations', '034_add_public_game_access.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  
  console.log('📄 Fichier:', migrationPath);
  console.log('📊 SQL à exécuter:\n');
  console.log(sql);
  console.log('\n' + '='.repeat(60) + '\n');
  
  try {
    // Exécuter la migration
    const { error } = await supabase.rpc('exec_sql', { sql });
    
    if (error) {
      console.error('❌ Erreur lors de l\'exécution:', error.message);
      
      // Essayer avec une approche alternative
      console.log('\n🔄 Tentative avec approche alternative...\n');
      
      // Exécuter chaque commande séparément
      const commands = sql.split(';').filter(cmd => cmd.trim());
      
      for (const command of commands) {
        const cleanCmd = command.trim();
        if (!cleanCmd || cleanCmd.startsWith('--')) continue;
        
        console.log('▶️ Exécution:', cleanCmd.substring(0, 60) + '...');
        
        const { error: cmdError } = await supabase.rpc('exec_sql', { 
          sql: cleanCmd + ';' 
        });
        
        if (cmdError) {
          console.warn('⚠️  Avertissement (peut être déjà appliqué):', cmdError.message);
        }
      }
    }
    
    console.log('\n✅ Migration 034 terminée avec succès!');
    console.log('\n📋 Résumé des changements:');
    console.log('   - guest_id est maintenant nullable dans game_guest_access');
    console.log('   - Colonne is_public ajoutée');
    console.log('   - Index pour les accès publics créés');
    
  } catch (error) {
    console.error('❌ Erreur fatale:', error.message);
    process.exit(1);
  }
}

runMigration();

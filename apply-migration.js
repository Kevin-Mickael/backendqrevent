/**
 * Script pour appliquer la migration 034 directement via Supabase
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variables d\'environnement manquantes:');
  console.error('   SUPABASE_URL:', supabaseUrl ? 'OK' : 'MANQUANT');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? 'OK' : 'MANQUANT');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  console.log('🚀 Application de la migration 034...\n');
  
  try {
    // 1. Rendre guest_id nullable
    console.log('1️⃣  Modification de game_guest_access (guest_id nullable)...');
    const { error: err1 } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE game_guest_access ALTER COLUMN guest_id DROP NOT NULL;'
    });
    if (err1) {
      console.log('   ⚠️  Info:', err1.message);
    } else {
      console.log('   ✅ OK');
    }

    // 2. Ajouter colonne is_public
    console.log('2️⃣  Ajout colonne is_public...');
    const { error: err2 } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE game_guest_access ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;'
    });
    if (err2) {
      console.log('   ⚠️  Info:', err2.message);
    } else {
      console.log('   ✅ OK');
    }

    // 3. Supprimer contrainte d'unicité
    console.log('3️⃣  Suppression contrainte d\'unicité...');
    const { error: err3 } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE game_guest_access DROP CONSTRAINT IF EXISTS game_guest_access_game_id_guest_id_key;'
    });
    if (err3) {
      console.log('   ⚠️  Info:', err3.message);
    } else {
      console.log('   ✅ OK');
    }

    // 4. Supprimer ancien index unique
    console.log('4️⃣  Suppression ancien index...');
    const { error: err4 } = await supabase.rpc('exec_sql', {
      sql: 'DROP INDEX IF EXISTS idx_game_guest_access_unique;'
    });
    if (err4) {
      console.log('   ⚠️  Info:', err4.message);
    } else {
      console.log('   ✅ OK');
    }

    // 5. Créer index pour accès publics
    console.log('5️⃣  Création index accès publics...');
    const { error: err5 } = await supabase.rpc('exec_sql', {
      sql: 'CREATE INDEX IF NOT EXISTS idx_game_guest_access_public ON game_guest_access (game_id, is_public) WHERE is_public = TRUE;'
    });
    if (err5) {
      console.log('   ⚠️  Info:', err5.message);
    } else {
      console.log('   ✅ OK');
    }

    // 6. Créer index pour tokens
    console.log('6️⃣  Création index tokens...');
    const { error: err6 } = await supabase.rpc('exec_sql', {
      sql: 'CREATE INDEX IF NOT EXISTS idx_game_guest_access_token ON game_guest_access (access_token);'
    });
    if (err6) {
      console.log('   ⚠️  Info:', err6.message);
    } else {
      console.log('   ✅ OK');
    }

    console.log('\n✅ Migration 034 terminée !');
    
    // Vérifier la structure
    console.log('\n📊 Vérification de la structure...');
    const { data: columns, error: errCol } = await supabase
      .from('information_schema.columns')
      .select('column_name, is_nullable')
      .eq('table_name', 'game_guest_access');
      
    if (!errCol && columns) {
      console.log('   Colonnes de game_guest_access:');
      columns.forEach(col => {
        console.log(`   - ${col.column_name}: ${col.is_nullable === 'YES' ? 'nullable' : 'NOT NULL'}`);
      });
    }
    
  } catch (error) {
    console.error('\n❌ Erreur:', error.message);
    process.exit(1);
  }
}

// Alternative: si exec_sql n'existe pas, on utilise une autre approche
async function applyMigrationAlternative() {
  console.log('🔄 Tentative avec approche alternative...\n');
  
  // Vérifier si is_public existe déjà
  const { data: colCheck, error: colErr } = await supabase
    .from('information_schema.columns')
    .select('column_name')
    .eq('table_name', 'game_guest_access')
    .eq('column_name', 'is_public');
    
  if (!colErr && colCheck && colCheck.length > 0) {
    console.log('✅ Colonne is_public existe déjà');
  } else {
    console.log('❌ Impossible de vérifier/appliquer la migration automatiquement');
    console.log('\n💡 Veuillez exécuter ce SQL manuellement dans Supabase SQL Editor:\n');
    console.log(`
ALTER TABLE game_guest_access ALTER COLUMN guest_id DROP NOT NULL;
ALTER TABLE game_guest_access ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;
ALTER TABLE game_guest_access DROP CONSTRAINT IF EXISTS game_guest_access_game_id_guest_id_key;
DROP INDEX IF EXISTS idx_game_guest_access_unique;
CREATE INDEX IF NOT EXISTS idx_game_guest_access_public ON game_guest_access (game_id, is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_game_guest_access_token ON game_guest_access (access_token);
    `);
  }
}

// Exécuter
applyMigration().catch(() => {
  applyMigrationAlternative();
});

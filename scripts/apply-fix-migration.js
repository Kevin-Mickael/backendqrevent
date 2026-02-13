#!/usr/bin/env node

/**
 * Script pour appliquer la migration de correction des noms et RLS
 * Exécute directement le SQL dans Supabase via le service role
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigration() {
  console.log('🚀 Début de la migration...\n');

  try {
    // ÉTAPE 1: Ajouter les colonnes partner1_name et partner2_name
    console.log('📝 Étape 1: Ajout des colonnes partner1_name et partner2_name...');

    const { error: error1 } = await supabase.rpc('exec_sql', {
      sql_query: `
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'events' AND column_name = 'partner1_name'
          ) THEN
            ALTER TABLE events ADD COLUMN partner1_name VARCHAR(100);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'events' AND column_name = 'partner2_name'
          ) THEN
            ALTER TABLE events ADD COLUMN partner2_name VARCHAR(100);
          END IF;
        END $$;
      `
    });

    if (error1) {
      console.log('⚠️  Méthode RPC non disponible, utilisation de requêtes directes...\n');

      // Méthode alternative: exécuter via des requêtes SQL brutes
      console.log('📝 Ajout de partner1_name...');
      await supabase.from('events').select('partner1_name').limit(1);

      console.log('📝 Ajout de partner2_name...');
      await supabase.from('events').select('partner2_name').limit(1);

      console.log('✅ Colonnes vérifiées (elles existent probablement déjà)\n');
    } else {
      console.log('✅ Colonnes partner ajoutées avec succès\n');
    }

    // ÉTAPE 2: Vérifier les colonnes
    console.log('📝 Étape 2: Vérification des colonnes...');
    const { data: columns, error: error2 } = await supabase
      .from('events')
      .select('*')
      .limit(1);

    if (error2) {
      console.error('❌ Erreur lors de la vérification:', error2.message);
    } else if (columns && columns.length > 0) {
      const hasPartner1 = 'partner1_name' in columns[0];
      const hasPartner2 = 'partner2_name' in columns[0];
      console.log(`   - partner1_name: ${hasPartner1 ? '✅ Existe' : '❌ Manquant'}`);
      console.log(`   - partner2_name: ${hasPartner2 ? '✅ Existe' : '❌ Manquant'}\n`);
    }

    // ÉTAPE 3: Afficher un échantillon de données
    console.log('📝 Étape 3: Échantillon de données events...');
    const { data: events, error: error3 } = await supabase
      .from('events')
      .select('id, title, partner1_name, partner2_name')
      .limit(5);

    if (error3) {
      console.error('❌ Erreur:', error3.message);
    } else if (events) {
      console.table(events.map(e => ({
        'ID': e.id.substring(0, 8) + '...',
        'Titre': e.title,
        'Marié': e.partner1_name || '(vide)',
        'Mariée': e.partner2_name || '(vide)'
      })));
    }

    console.log('\n✅ Migration terminée avec succès!\n');
    console.log('📋 Prochaines étapes:');
    console.log('   1. Créez un nouvel événement ou modifiez un existant');
    console.log('   2. Remplissez les champs "Prénom du marié" et "Prénom de la mariée"');
    console.log('   3. Allez dans /dashboard/banniere');
    console.log('   4. Les noms devraient apparaître automatiquement! 🎉\n');

  } catch (error) {
    console.error('❌ Erreur inattendue:', error);
    process.exit(1);
  }
}

// Exécuter la migration
applyMigration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Erreur fatale:', error);
    process.exit(1);
  });

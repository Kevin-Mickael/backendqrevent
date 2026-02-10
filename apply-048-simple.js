/**
 * Script simple pour appliquer la migration 048 via requêtes directes
 */

require('dotenv').config();
const { supabaseService } = require('./config/supabase');

async function applySimpleMigration() {
  console.log('🚀 Application simple de la migration 048...\n');
  
  try {
    // Tester d'abord en essayant de récupérer la structure actuelle de la table
    console.log('🔍 Vérification de la structure actuelle de la table events...');
    
    const { data: existingColumns, error: descError } = await supabaseService
      .from('information_schema.columns')
      .select('column_name, data_type')
      .eq('table_name', 'events');
    
    if (descError) {
      console.error('❌ Impossible de vérifier la structure:', descError.message);
      
      // Alternative : essayons de créer un événement de test pour voir quelle erreur on obtient
      console.log('🔧 Test de création d\'événement pour diagnostiquer...');
      
      const testEventData = {
        title: 'Test Migration',
        description: 'Test',
        date: new Date().toISOString(),
        organizer_id: 'test-user-id',
        is_active: true,
        settings: {
          enableRSVP: true,
          enableGames: false
        },
        partner1_name: 'Test Partner 1',
        partner2_name: 'Test Partner 2',
        event_schedule: []
      };
      
      console.log('Tentative d\'insertion de test...');
      const { data: testResult, error: testError } = await supabaseService
        .from('events')
        .insert([testEventData])
        .select()
        .single();
      
      if (testError) {
        console.log('❌ Erreur de test (attendue):', testError.message);
        
        // Analyser l'erreur pour déterminer les colonnes manquantes
        if (testError.message.includes('column') && testError.message.includes('does not exist')) {
          console.log('\n📋 Colonnes manquantes détectées dans l\'erreur');
          
          // Essayer d'ajouter les colonnes une par une sans RPC
          console.log('\n🔧 Tentative d\'ajout des colonnes via les métadonnées...');
          
          // Cette approche ne marchera pas non plus car Supabase ne permet pas ALTER TABLE
          // directement via l'API client. Nous devons utiliser les fonctions SQL ou l'interface web.
          
          console.log('\n⚠️  SOLUTION ALTERNATIVE REQUISE:');
          console.log('1. Connexion à Supabase Dashboard');
          console.log('2. Aller dans SQL Editor');
          console.log('3. Exécuter le script de migration manuellement');
          console.log('\nScript à exécuter:');
          console.log('==================');
          
          const migrationScript = `
-- Ajouter les colonnes manquantes
ALTER TABLE events ADD COLUMN IF NOT EXISTS partner1_name VARCHAR(100);
ALTER TABLE events ADD COLUMN IF NOT EXISTS partner2_name VARCHAR(100);
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_schedule JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{
  "enableRSVP": true,
  "enableGames": false,
  "enablePhotoGallery": true,
  "enableGuestBook": true,
  "enableQRVerification": true
}';
ALTER TABLE events ADD COLUMN IF NOT EXISTS cover_image TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS banner_image TEXT;

-- Migrer les données existantes
UPDATE events 
SET partner1_name = groom_name,
    partner2_name = bride_name
WHERE (partner1_name IS NULL AND groom_name IS NOT NULL) 
   OR (partner2_name IS NULL AND bride_name IS NOT NULL);

-- Créer les index
CREATE INDEX IF NOT EXISTS idx_events_partners ON events(partner1_name, partner2_name) WHERE partner1_name IS NOT NULL OR partner2_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_schedule ON events USING GIN (event_schedule) WHERE event_schedule IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_settings ON events USING GIN (settings) WHERE settings IS NOT NULL;
`;
          
          console.log(migrationScript);
          console.log('==================');
          
        }
      } else {
        console.log('✅ Test réussi - les colonnes existent déjà !');
        console.log('Événement de test créé:', testResult.id);
        
        // Nettoyer l'événement de test
        await supabaseService.from('events').delete().eq('id', testResult.id);
        console.log('🧹 Événement de test supprimé');
      }
      
    } else {
      console.log('📊 Colonnes existantes:');
      existingColumns.forEach(col => {
        console.log(`  - ${col.column_name} (${col.data_type})`);
      });
      
      // Vérifier quelles colonnes manquent
      const requiredColumns = ['partner1_name', 'partner2_name', 'event_schedule', 'settings', 'cover_image', 'banner_image'];
      const existingColumnNames = existingColumns.map(col => col.column_name);
      const missingColumns = requiredColumns.filter(col => !existingColumnNames.includes(col));
      
      if (missingColumns.length > 0) {
        console.log('\n❌ Colonnes manquantes:', missingColumns.join(', '));
      } else {
        console.log('\n✅ Toutes les colonnes requises sont présentes !');
      }
    }
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  }
}

applySimpleMigration();
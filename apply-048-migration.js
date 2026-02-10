/**
 * Script pour appliquer la migration 048 - correction du schéma events
 */

require('dotenv').config();
const fs = require('fs');
const { supabaseService } = require('./config/supabase');

async function applyMigration048() {
  console.log('🚀 Application de la migration 048 - correction schéma events...\n');
  
  try {
    // Lire le fichier de migration
    const migrationSQL = fs.readFileSync('./migrations/048_fix_events_schema.sql', 'utf8');
    
    // Exécuter la migration
    console.log('📄 Exécution du script SQL...');
    
    // Pour Supabase, on doit exécuter chaque commande séparément
    // Car Supabase n'accepte pas les blocs PL/pgSQL complexes en une fois
    
    console.log('1️⃣  Ajout de partner1_name...');
    const { error: err1 } = await supabaseService.rpc('exec_sql', {
      sql: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'partner1_name') THEN
          ALTER TABLE events ADD COLUMN partner1_name VARCHAR(100);
        END IF;
      END $$;`
    });
    if (err1) console.log('   Info:', err1.message);
    else console.log('   ✅ OK');
    
    console.log('2️⃣  Ajout de partner2_name...');
    const { error: err2 } = await supabaseService.rpc('exec_sql', {
      sql: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'partner2_name') THEN
          ALTER TABLE events ADD COLUMN partner2_name VARCHAR(100);
        END IF;
      END $$;`
    });
    if (err2) console.log('   Info:', err2.message);
    else console.log('   ✅ OK');
    
    console.log('3️⃣  Ajout de event_schedule...');
    const { error: err3 } = await supabaseService.rpc('exec_sql', {
      sql: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'event_schedule') THEN
          ALTER TABLE events ADD COLUMN event_schedule JSONB DEFAULT '[]';
        END IF;
      END $$;`
    });
    if (err3) console.log('   Info:', err3.message);
    else console.log('   ✅ OK');
    
    console.log('4️⃣  Ajout de settings...');
    const { error: err4 } = await supabaseService.rpc('exec_sql', {
      sql: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'settings') THEN
          ALTER TABLE events ADD COLUMN settings JSONB DEFAULT '{
            "enableRSVP": true,
            "enableGames": false,
            "enablePhotoGallery": true,
            "enableGuestBook": true,
            "enableQRVerification": true
          }';
        END IF;
      END $$;`
    });
    if (err4) console.log('   Info:', err4.message);
    else console.log('   ✅ OK');
    
    console.log('5️⃣  Ajout de cover_image...');
    const { error: err5 } = await supabaseService.rpc('exec_sql', {
      sql: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'cover_image') THEN
          ALTER TABLE events ADD COLUMN cover_image TEXT;
        END IF;
      END $$;`
    });
    if (err5) console.log('   Info:', err5.message);
    else console.log('   ✅ OK');
    
    console.log('6️⃣  Ajout de banner_image...');
    const { error: err6 } = await supabaseService.rpc('exec_sql', {
      sql: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'banner_image') THEN
          ALTER TABLE events ADD COLUMN banner_image TEXT;
        END IF;
      END $$;`
    });
    if (err6) console.log('   Info:', err6.message);
    else console.log('   ✅ OK');
    
    console.log('7️⃣  Migration des données existantes...');
    const { error: err7 } = await supabaseService.rpc('exec_sql', {
      sql: `UPDATE events 
            SET partner1_name = groom_name,
                partner2_name = bride_name
            WHERE (partner1_name IS NULL AND groom_name IS NOT NULL) 
               OR (partner2_name IS NULL AND bride_name IS NOT NULL);`
    });
    if (err7) console.log('   Info:', err7.message);
    else console.log('   ✅ OK');
    
    console.log('8️⃣  Création des index...');
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_events_partners ON events(partner1_name, partner2_name) WHERE partner1_name IS NOT NULL OR partner2_name IS NOT NULL;`,
      `CREATE INDEX IF NOT EXISTS idx_events_schedule ON events USING GIN (event_schedule) WHERE event_schedule IS NOT NULL;`,
      `CREATE INDEX IF NOT EXISTS idx_events_settings ON events USING GIN (settings) WHERE settings IS NOT NULL;`
    ];
    
    for (const indexSQL of indexes) {
      const { error } = await supabaseService.rpc('exec_sql', { sql: indexSQL });
      if (error) console.log('   Info:', error.message);
    }
    console.log('   ✅ OK');
    
    console.log('\n✅ Migration 048 terminée avec succès !');
    
    // Vérification finale
    console.log('\n📊 Vérification des colonnes...');
    const { data: columns, error: checkError } = await supabaseService.rpc('exec_sql', {
      sql: `SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'events' 
              AND column_name IN ('partner1_name', 'partner2_name', 'event_schedule', 'settings', 'cover_image', 'banner_image')
            ORDER BY column_name;`
    });
    
    if (columns) {
      console.log('Colonnes ajoutées:');
      columns.forEach(col => {
        console.log(`  - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
      });
    }

  } catch (error) {
    console.error('❌ Erreur lors de la migration:', error.message);
    process.exit(1);
  }
}

applyMigration048();
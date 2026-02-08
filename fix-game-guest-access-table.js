#!/usr/bin/env node
/**
 * Script pour créer la table game_guest_access si elle n'existe pas
 * et appliquer les migrations nécessaires (007 + 034)
 */

require('dotenv').config();
const { Client } = require('pg');

const connectionString = process.env.SUPABASE_CONNECTION_STRING;

if (!connectionString) {
  console.error('❌ SUPABASE_CONNECTION_STRING manquant dans .env');
  process.exit(1);
}

// SQL pour créer la table game_guest_access (migration 007)
const createTableSQL = `
-- Créer la table game_guest_access si elle n'existe pas
CREATE TABLE IF NOT EXISTS game_guest_access (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    guest_id UUID REFERENCES guests(id) ON DELETE CASCADE,
    qr_code VARCHAR(50) REFERENCES qr_codes(code) ON DELETE CASCADE,
    access_token VARCHAR(100) UNIQUE NOT NULL,
    has_played BOOLEAN DEFAULT FALSE,
    played_at TIMESTAMP WITH TIME ZONE,
    score INTEGER DEFAULT 0,
    rank INTEGER,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_game_guest_access_game ON game_guest_access(game_id);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_guest ON game_guest_access(guest_id);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_token ON game_guest_access(access_token);
CREATE INDEX IF NOT EXISTS idx_game_guest_access_public ON game_guest_access (game_id, is_public) WHERE is_public = TRUE;
`;

// SQL pour créer la table game_family_access aussi (liée)
const createFamilyAccessSQL = `
CREATE TABLE IF NOT EXISTS game_family_access (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    game_id UUID REFERENCES games(id) ON DELETE CASCADE NOT NULL,
    family_id UUID REFERENCES families(id) ON DELETE CASCADE NOT NULL,
    qr_code VARCHAR(50) REFERENCES qr_codes(code) ON DELETE CASCADE,
    access_token VARCHAR(100) UNIQUE NOT NULL,
    has_played BOOLEAN DEFAULT FALSE,
    played_at TIMESTAMP WITH TIME ZONE,
    score INTEGER DEFAULT 0,
    rank INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(game_id, family_id)
);

CREATE INDEX IF NOT EXISTS idx_game_family_access_game ON game_family_access(game_id);
CREATE INDEX IF NOT EXISTS idx_game_family_access_family ON game_family_access(family_id);
CREATE INDEX IF NOT EXISTS idx_game_family_access_token ON game_family_access(access_token);
`;

// SQL pour ajouter les colonnes à game_participations
const alterParticipationsSQL = `
ALTER TABLE game_participations 
ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES families(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS qr_code VARCHAR(50) REFERENCES qr_codes(code) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS access_token VARCHAR(100),
ADD COLUMN IF NOT EXISTS player_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS player_type VARCHAR(20) DEFAULT 'individual' CHECK (player_type IN ('individual', 'family'));

CREATE INDEX IF NOT EXISTS idx_game_participations_family ON game_participations(family_id);
CREATE INDEX IF NOT EXISTS idx_game_participations_qr ON game_participations(qr_code);
CREATE INDEX IF NOT EXISTS idx_game_participations_token ON game_participations(access_token);
`;

async function applyMigrations() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔧 Connexion à la base de données...');
    await client.connect();
    console.log('✅ Connecté\n');

    // 1. Créer la table game_guest_access
    console.log('1️⃣  Création de la table game_guest_access...');
    await client.query(createTableSQL);
    console.log('   ✅ Table game_guest_access créée\n');

    // 2. Créer la table game_family_access
    console.log('2️⃣  Création de la table game_family_access...');
    await client.query(createFamilyAccessSQL);
    console.log('   ✅ Table game_family_access créée\n');

    // 3. Modifier game_participations
    console.log('3️⃣  Ajout des colonnes à game_participations...');
    await client.query(alterParticipationsSQL);
    console.log('   ✅ Colonnes ajoutées\n');

    // 4. Vérifier la structure
    console.log('4️⃣  Vérification de la structure...');
    const { rows: columns } = await client.query(`
      SELECT column_name, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'game_guest_access'
      ORDER BY ordinal_position;
    `);
    
    console.log('   📊 Colonnes de game_guest_access:');
    columns.forEach(col => {
      console.log(`      - ${col.column_name}: ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

    console.log('\n✅ Toutes les migrations ont été appliquées avec succès !');
    console.log('🎉 Vous pouvez maintenant créer des jeux et générer des QR codes.');

  } catch (error) {
    console.error('\n❌ Erreur:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigrations();

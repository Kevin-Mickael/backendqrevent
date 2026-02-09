const fs = require('fs');
const { Pool } = require('pg');

// Configuration PostgreSQL depuis .env
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('📁 Lecture du fichier de migration 043...');
    const migrationSQL = fs.readFileSync('./migrations/043_fix_game_statistics_and_ranking.sql', 'utf8');
    
    console.log('🚀 Exécution de la migration...');
    const result = await client.query(migrationSQL);
    
    console.log('✅ Migration 043 exécutée avec succès!');
    
    // Vérification des rangs mis à jour
    console.log('🔍 Vérification des rangs mis à jour...');
    const rankCheck = await client.query(`
      SELECT 
        gp.game_id,
        COUNT(*) as participants,
        COUNT(CASE WHEN gp.rank IS NOT NULL THEN 1 END) as participants_with_rank,
        MIN(gp.rank) as min_rank,
        MAX(gp.rank) as max_rank
      FROM game_participations gp 
      WHERE gp.is_completed = true
      GROUP BY gp.game_id
      ORDER BY gp.game_id;
    `);
    
    console.log('📊 Statistiques des rangs:');
    console.table(rankCheck.rows);
    
    // Vérification de la vue game_leaderboard
    console.log('🎯 Test de la vue game_leaderboard...');
    const leaderboardTest = await client.query(`
      SELECT game_id, display_name, score, rank 
      FROM game_leaderboard 
      LIMIT 5;
    `);
    
    console.log('🏆 Exemple de classement:');
    console.table(leaderboardTest.rows);
    
  } catch (error) {
    console.error('❌ Erreur lors de l\'exécution de la migration:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('🎉 Migration terminée avec succès!');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Échec de la migration:', error);
    process.exit(1);
  });
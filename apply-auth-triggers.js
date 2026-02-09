const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');

// Configuration de la base de données Supabase
require('dotenv').config();
const pool = new Pool({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
});

async function applyAuthTriggers() {
    try {
        console.log('🚀 Application des triggers Supabase Auth...');
        
        const migrationPath = path.join(__dirname, 'migrations', '045_supabase_auth_triggers.sql');
        const migrationContent = await fs.readFile(migrationPath, 'utf8');
        
        console.log('📄 Lecture de la migration:', migrationPath);
        
        const client = await pool.connect();
        try {
            console.log('✅ Connexion à la base de données...');
            await client.query(migrationContent);
            console.log('✅ Migration auth triggers appliquée avec succès !');
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'application de la migration:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

applyAuthTriggers();
const { Pool } = require('pg');

// Configuration à partir du .env
const pool = new Pool({
    connectionString: process.env.SUPABASE_CONNECTION_STRING || process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkTables() {
    try {
        console.log('🔍 Vérification directe des tables...');
        
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        console.log(`✅ Tables trouvées (${result.rows.length}):`);
        result.rows.forEach(row => {
            console.log(`  - ${row.table_name}`);
        });
        
        // Vérifier les vues matérialisées
        const materialized = await pool.query(`
            SELECT matviewname 
            FROM pg_matviews 
            WHERE schemaname = 'public'
        `);
        
        console.log(`\n📊 Vues matérialisées (${materialized.rows.length}):`);
        materialized.rows.forEach(row => {
            console.log(`  - ${row.matviewname}`);
        });
        
        // Vérifier les index
        const indexes = await pool.query(`
            SELECT indexname, tablename 
            FROM pg_indexes 
            WHERE schemaname = 'public' 
            ORDER BY tablename, indexname
        `);
        
        console.log(`\n🔍 Index créés (${indexes.rows.length}):`);
        const tableIndexes = {};
        indexes.rows.forEach(row => {
            if (!tableIndexes[row.tablename]) {
                tableIndexes[row.tablename] = [];
            }
            tableIndexes[row.tablename].push(row.indexname);
        });
        
        Object.keys(tableIndexes).forEach(table => {
            console.log(`  ${table}:`);
            tableIndexes[table].forEach(index => {
                console.log(`    - ${index}`);
            });
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la vérification:', error.message);
    } finally {
        await pool.end();
    }
}

checkTables();
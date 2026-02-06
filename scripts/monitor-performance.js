#!/usr/bin/env node
/**
 * Performance Monitor
 * 
 * Surveille les performances de la base de données et alerte sur les problèmes.
 * 
 * Usage: node scripts/monitor-performance.js
 * Cron: */5 * * * * cd /path && node scripts/monitor-performance.js
 */

const { Client } = require('pg');
const logger = require('../utils/logger');

// Configuration
const CONFIG = {
  // Seuils d'alerte
  THRESHOLDS: {
    SLOW_QUERY_MS: 1000,      // Requêtes lentes
    CONNECTION_USAGE: 80,      // % utilisation connexions
    DEAD_TUPLES_RATIO: 20,    // % de dead tuples
    SEQ_SCAN_RATIO: 50,        // % de seq scans
    CACHE_HIT_RATIO: 95        // % cache hit (doit être >)
  },
  
  // Connexion DB
  CONNECTION_STRING: process.env.SUPABASE_CONNECTION_STRING
};

/**
 * Vérifie les requêtes lentes en cours
 */
const checkSlowQueries = async (client) => {
  const result = await client.query(`
    SELECT 
      pid,
      now() - query_start AS duration,
      state,
      query
    FROM pg_stat_activity
    WHERE state = 'active'
      AND query_start < now() - interval '${CONFIG.THRESHOLDS.SLOW_QUERY_MS} milliseconds'
      AND query NOT LIKE '%pg_stat_activity%'
    ORDER BY duration DESC
    LIMIT 5
  `);

  if (result.rows.length > 0) {
    logger.warn(`⚠️  ${result.rows.length} slow queries detected:`, {
      queries: result.rows.map(r => ({
        pid: r.pid,
        duration: r.duration,
        query: r.query.substring(0, 100) + '...'
      }))
    });
  }

  return result.rows;
};

/**
 * Vérifie l'utilisation des connexions
 */
const checkConnectionUsage = async (client) => {
  const result = await client.query(`
    SELECT 
      count(*) as used,
      (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max
    FROM pg_stat_activity
  `);

  const { used, max } = result.rows[0];
  const usagePercent = (used / max) * 100;

  if (usagePercent > CONFIG.THRESHOLDS.CONNECTION_USAGE) {
    logger.warn(`⚠️  High connection usage: ${usagePercent.toFixed(1)}% (${used}/${max})`);
  }

  return { used, max, percent: usagePercent };
};

/**
 * Vérifie le ratio cache hit
 */
const checkCacheHitRatio = async (client) => {
  const result = await client.query(`
    SELECT 
      round(blks_hit * 100.0 / nullif(blks_hit + blks_read, 0), 2) as cache_hit_ratio
    FROM pg_stat_database
    WHERE datname = current_database()
  `);

  const ratio = parseFloat(result.rows[0]?.cache_hit_ratio || 0);

  if (ratio < CONFIG.THRESHOLDS.CACHE_HIT_RATIO) {
    logger.warn(`⚠️  Low cache hit ratio: ${ratio}% (target: ${CONFIG.THRESHOLDS.CACHE_HIT_RATIO}%)`);
  }

  return ratio;
};

/**
 * Vérifie les tables avec beaucoup de dead tuples
 */
const checkDeadTuples = async (client) => {
  const result = await client.query(`
    SELECT 
      schemaname,
      tablename,
      n_tup_ins,
      n_tup_upd,
      n_tup_del,
      n_live_tup,
      n_dead_tup,
      round(n_dead_tup * 100.0 / nullif(n_live_tup + n_dead_tup, 0), 2) as dead_ratio
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 1000
    ORDER BY dead_ratio DESC
    LIMIT 5
  `);

  const problematic = result.rows.filter(r => parseFloat(r.dead_ratio) > CONFIG.THRESHOLDS.DEAD_TUPLES_RATIO);

  if (problematic.length > 0) {
    logger.warn(`⚠️  Tables needing vacuum:`, {
      tables: problematic.map(r => ({
        table: `${r.schemaname}.${r.tablename}`,
        deadRatio: `${r.dead_ratio}%`,
        deadTuples: r.n_dead_tup
      }))
    });
  }

  return result.rows;
};

/**
 * Vérifie les index non utilisés
 */
const checkUnusedIndexes = async (client) => {
  const result = await client.query(`
    SELECT 
      schemaname,
      tablename,
      indexname,
      idx_scan,
      pg_size_pretty(pg_relation_size(indexrelid)) as index_size
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
      AND indexname NOT LIKE '%pkey%'
      AND indexname NOT LIKE '%unique%'
    ORDER BY pg_relation_size(indexrelid) DESC
    LIMIT 10
  `);

  if (result.rows.length > 0) {
    logger.info(`ℹ️  ${result.rows.length} unused indexes found`, {
      indexes: result.rows.map(r => ({
        table: `${r.schemaname}.${r.tablename}`,
        index: r.indexname,
        size: r.index_size
      }))
    });
  }

  return result.rows;
};

/**
 * Vérifie les tables avec trop de seq scans
 */
const checkSeqScans = async (client) => {
  const result = await client.query(`
    SELECT 
      schemaname,
      tablename,
      seq_scan,
      seq_tup_read,
      idx_scan,
      idx_tup_fetch,
      CASE 
        WHEN seq_scan + idx_scan = 0 THEN 0
        ELSE round(seq_scan * 100.0 / (seq_scan + idx_scan), 2)
      END as seq_scan_ratio
    FROM pg_stat_user_tables
    WHERE seq_scan > 100
    ORDER BY seq_scan DESC
    LIMIT 10
  `);

  const problematic = result.rows.filter(r => parseFloat(r.seq_scan_ratio) > CONFIG.THRESHOLDS.SEQ_SCAN_RATIO);

  if (problematic.length > 0) {
    logger.warn(`⚠️  Tables with high seq scan ratio:`, {
      tables: problematic.map(r => ({
        table: `${r.schemaname}.${r.tablename}`,
        seqScanRatio: `${r.seq_scan_ratio}%`,
        seqScans: r.seq_scan
      }))
    });
  }

  return result.rows;
};

/**
 * Statistiques des tables principales
 */
const getTableStats = async (client) => {
  const result = await client.query(`
    SELECT 
      tablename,
      n_live_tup as row_count,
      pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as total_size,
      pg_size_pretty(pg_indexes_size(schemaname || '.' || tablename)) as index_size
    FROM pg_stat_user_tables
    WHERE tablename IN ('events', 'guests', 'qr_codes', 'attendance', 'games', 'game_participations')
    ORDER BY n_live_tup DESC
  `);

  return result.rows;
};

/**
 * Fonction principale
 */
const runMonitoring = async () => {
  if (!CONFIG.CONNECTION_STRING) {
    logger.error('SUPABASE_CONNECTION_STRING not set');
    process.exit(1);
  }

  const client = new Client({
    connectionString: CONFIG.CONNECTION_STRING,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    logger.info('🔍 Starting performance monitoring...');

    const startTime = Date.now();

    // Exécuter tous les checks
    const [
      slowQueries,
      connectionUsage,
      cacheHitRatio,
      deadTuples,
      unusedIndexes,
      seqScans,
      tableStats
    ] = await Promise.all([
      checkSlowQueries(client),
      checkConnectionUsage(client),
      checkCacheHitRatio(client),
      checkDeadTuples(client),
      checkUnusedIndexes(client),
      checkSeqScans(client),
      getTableStats(client)
    ]);

    const duration = Date.now() - startTime;

    // Résumé
    logger.info('📊 Performance Summary', {
      duration: `${duration}ms`,
      slowQueries: slowQueries.length,
      connectionUsage: `${connectionUsage.percent.toFixed(1)}%`,
      cacheHitRatio: `${cacheHitRatio}%`,
      tablesNeedingVacuum: deadTuples.filter(r => parseFloat(r.dead_ratio) > CONFIG.THRESHOLDS.DEAD_TUPLES_RATIO).length,
      unusedIndexes: unusedIndexes.length,
      tablesWithSeqScans: seqScans.filter(r => parseFloat(r.seq_scan_ratio) > CONFIG.THRESHOLDS.SEQ_SCAN_RATIO).length
    });

    logger.info('📈 Table Statistics', {
      tables: tableStats.map(t => ({
        name: t.tablename,
        rows: parseInt(t.row_count).toLocaleString(),
        size: t.total_size,
        indexSize: t.index_size
      }))
    });

    // Alertes critiques
    const hasCriticalIssues = 
      slowQueries.length > 5 ||
      connectionUsage.percent > 90 ||
      cacheHitRatio < 90;

    if (hasCriticalIssues) {
      logger.error('🚨 CRITICAL PERFORMANCE ISSUES DETECTED!');
      process.exit(1);
    }

  } catch (error) {
    logger.error('Monitoring failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
};

// Exécuter si lancé directement
if (require.main === module) {
  runMonitoring();
}

module.exports = {
  runMonitoring,
  checkSlowQueries,
  checkCacheHitRatio,
  checkDeadTuples
};

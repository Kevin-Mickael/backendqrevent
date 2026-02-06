/**
 * Materialized Views Refresher
 * 
 * Rafraîchit les vues matérialisées périodiquement.
 * À exécuter via cron ou en tant que service continu.
 * 
 * Usage: node jobs/refreshMaterializedViews.js
 * Cron: */5 * * * * cd /path && node jobs/refreshMaterializedViews.js
 */

const { supabaseService } = require('../config/supabase');
const logger = require('../utils/logger');

const CONFIG = {
  // Intervalle de rafraîchissement (ms)
  // Par défaut: 5 minutes
  REFRESH_INTERVAL: parseInt(process.env.REFRESH_INTERVAL_MS) || 5 * 60 * 1000,
  
  // Vues à rafraîchir avec leur fréquence
  VIEWS: [
    { name: 'mv_event_summary', priority: 'high', minInterval: 5 * 60 },     // 5 min
    { name: 'mv_qr_code_stats', priority: 'medium', minInterval: 10 * 60 },  // 10 min
    { name: 'mv_game_stats', priority: 'medium', minInterval: 10 * 60 }      // 10 min
  ]
};

/**
 * Rafraîchit une vue matérialisée
 */
const refreshView = async (viewName) => {
  const startTime = Date.now();
  
  try {
    // Utilise CONCURRENTLY pour ne pas bloquer les lectures
    const { error } = await supabaseService.rpc('exec_sql', {
      query: `REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`
    });

    if (error) {
      // Fallback: rafraîchissement standard (bloquant mais nécessaire si pas d'index unique)
      const { error: fallbackError } = await supabaseService.rpc('exec_sql', {
        query: `REFRESH MATERIALIZED VIEW ${viewName}`
      });

      if (fallbackError) throw fallbackError;
    }

    const duration = Date.now() - startTime;
    logger.info(`✅ Refreshed ${viewName} in ${duration}ms`);
    
    return { success: true, duration };
  } catch (error) {
    logger.error(`❌ Failed to refresh ${viewName}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Rafraîchit toutes les vues
 */
const refreshAllViews = async () => {
  const results = [];

  // Traiter les vues high priority d'abord
  const sortedViews = [...CONFIG.VIEWS].sort((a, b) => {
    if (a.priority === 'high' && b.priority !== 'high') return -1;
    if (a.priority !== 'high' && b.priority === 'high') return 1;
    return 0;
  });

  for (const view of sortedViews) {
    const result = await refreshView(view.name);
    results.push({ view: view.name, ...result });
    
    // Petite pause entre les vues pour ne pas surcharger la DB
    if (sortedViews.indexOf(view) < sortedViews.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
};

/**
 * Vérifie si une vue matérialisée existe
 */
const checkViewExists = async (viewName) => {
  try {
    const { data, error } = await supabaseService
      .from('pg_matviews')
      .select('matviewname')
      .eq('matviewname', viewName)
      .single();

    return !error && data !== null;
  } catch (error) {
    return false;
  }
};

/**
 * Affiche les statistiques des vues
 */
const getViewsStats = async () => {
  try {
    const { data, error } = await supabaseService
      .from('pg_matviews')
      .select('matviewname, hasindexes')
      .in('matviewname', CONFIG.VIEWS.map(v => v.name));

    if (error) throw error;

    return data || [];
  } catch (error) {
    logger.error('Error getting views stats:', error.message);
    return [];
  }
};

/**
 * Boucle principale
 */
const startRefresher = async () => {
  logger.info('🔄 Materialized Views Refresher started');
  logger.info(`Refresh interval: ${CONFIG.REFRESH_INTERVAL / 1000}s`);

  // Vérifier que les vues existent
  for (const view of CONFIG.VIEWS) {
    const exists = await checkViewExists(view.name);
    if (!exists) {
      logger.warn(`⚠️  View ${view.name} does not exist yet`);
    } else {
      logger.info(`✅ View ${view.name} found`);
    }
  }

  // Afficher les stats initiales
  const stats = await getViewsStats();
  logger.info('Current materialized views:', stats);

  // Boucle de rafraîchissement
  setInterval(async () => {
    try {
      const results = await refreshAllViews();
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      if (failCount > 0) {
        logger.warn(`Refresh completed: ${successCount} success, ${failCount} failed`);
      } else {
        logger.info(`Refresh completed: ${successCount} views refreshed`);
      }
    } catch (error) {
      logger.error('Error in refresh loop:', error.message);
    }
  }, CONFIG.REFRESH_INTERVAL);

  // Premier rafraîchissement immédiat
  logger.info('Running initial refresh...');
  await refreshAllViews();

  // Gestion gracieuse de l'arrêt
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down...');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down...');
    process.exit(0);
  });
};

// Mode one-shot (pour cron)
const runOnce = async () => {
  logger.info('Running one-time refresh...');
  const results = await refreshAllViews();
  
  const failCount = results.filter(r => !r.success).length;
  
  if (failCount > 0) {
    process.exit(1);
  }
};

// Exécuter si lancé directement
if (require.main === module) {
  const mode = process.argv[2] || 'daemon';
  
  if (mode === 'once') {
    runOnce();
  } else {
    startRefresher();
  }
}

module.exports = {
  refreshView,
  refreshAllViews,
  startRefresher,
  runOnce,
  CONFIG
};

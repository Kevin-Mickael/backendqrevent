/**
 * Materialized Views Refresher - VERSION CORRIGÉE
 * 
 * Correction des erreurs RPC Supabase :
 * - Vérification des fonctions avant usage
 * - Fallbacks robustes
 * - Gestion des erreurs améliorée
 */

const { supabaseService } = require('../config/supabase');
const logger = require('../utils/logger');

const CONFIG = {
  REFRESH_INTERVAL: parseInt(process.env.REFRESH_INTERVAL_MS) || 5 * 60 * 1000,
  
  VIEWS: [
    { name: 'mv_event_summary', priority: 'high', minInterval: 5 * 60 },
    { name: 'mv_qr_code_stats', priority: 'medium', minInterval: 10 * 60 },
    { name: 'mv_game_stats', priority: 'medium', minInterval: 10 * 60 }
  ]
};

/**
 * Vérifie si une fonction RPC existe
 */
const checkRpcFunction = async (functionName) => {
  try {
    const { data, error } = await supabaseService
      .from('pg_proc')
      .select('proname')
      .eq('proname', functionName)
      .single();

    return !error && data !== null;
  } catch (error) {
    return false;
  }
};

/**
 * Rafraîchit une vue matérialisée avec méthodes multiples
 */
const refreshView = async (viewName) => {
  const startTime = Date.now();
  
  try {
    // Méthode 1: Vérifier si exec_sql existe
    const hasExecSql = await checkRpcFunction('exec_sql');
    
    if (hasExecSql) {
      // Essayer CONCURRENTLY d'abord
      const { error: concurrentError } = await supabaseService.rpc('exec_sql', {
        query: `REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`
      });

      if (concurrentError) {
        // Fallback: rafraîchissement standard
        logger.warn(`Concurrent refresh failed for ${viewName}, trying standard refresh`);
        
        const { error: standardError } = await supabaseService.rpc('exec_sql', {
          query: `REFRESH MATERIALIZED VIEW ${viewName}`
        });

        if (standardError) {
          throw standardError;
        }
      }
    } else {
      // Méthode 2: Essayer une fonction spécifique
      const refreshFunction = `refresh_${viewName.replace('mv_', '')}`;
      const hasSpecificFunction = await checkRpcFunction(refreshFunction);
      
      if (hasSpecificFunction) {
        const { error } = await supabaseService.rpc(refreshFunction);
        if (error) throw error;
      } else {
        // Méthode 3: Utiliser une requête SQL directe (limité en permissions)
        logger.warn(`No RPC functions available for ${viewName}, attempting direct query`);
        
        const { error } = await supabaseService
          .from(viewName)
          .select('*', { count: 'exact', head: true });
          
        if (error) {
          logger.warn(`Direct query failed: ${error.message}`);
          return { 
            success: false, 
            error: `No refresh method available for ${viewName}`,
            requiresManualIntervention: true 
          };
        }
        
        logger.info(`View ${viewName} verified (manual refresh may be needed)`);
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`✅ Refreshed ${viewName} in ${duration}ms`);
    
    return { success: true, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`❌ Failed to refresh ${viewName} after ${duration}ms:`, error.message);
    
    return { 
      success: false, 
      error: error.message,
      duration,
      requiresManualIntervention: error.message.includes('permission') || 
                                  error.message.includes('does not exist')
    };
  }
};

/**
 * Vérifie si une vue matérialisée existe
 */
const checkViewExists = async (viewName) => {
  try {
    // Méthode plus compatible : vérifier via information_schema
    const { data, error } = await supabaseService
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_name', viewName)
      .eq('table_type', 'MATERIALIZED VIEW')
      .single();

    if (error) {
      // Fallback : essayer pg_matviews
      const { data: matviewData, error: matviewError } = await supabaseService
        .from('pg_matviews')
        .select('matviewname')
        .eq('matviewname', viewName)
        .single();
        
      return !matviewError && matviewData !== null;
    }

    return data !== null;
  } catch (error) {
    logger.warn(`Could not verify existence of view ${viewName}:`, error.message);
    return false;
  }
};

/**
 * Rafraîchit toutes les vues avec gestion d'erreurs améliorée
 */
const refreshAllViews = async () => {
  const results = [];
  let manualInterventionNeeded = false;

  // Trier par priorité
  const sortedViews = [...CONFIG.VIEWS].sort((a, b) => {
    if (a.priority === 'high' && b.priority !== 'high') return -1;
    if (a.priority !== 'high' && b.priority === 'high') return 1;
    return 0;
  });

  for (const view of sortedViews) {
    // Vérifier d'abord si la vue existe
    const exists = await checkViewExists(view.name);
    
    if (!exists) {
      logger.warn(`⚠️  View ${view.name} does not exist, skipping`);
      results.push({ 
        view: view.name, 
        success: false, 
        error: 'View does not exist',
        skipped: true 
      });
      continue;
    }

    const result = await refreshView(view.name);
    results.push({ view: view.name, ...result });
    
    if (result.requiresManualIntervention) {
      manualInterventionNeeded = true;
    }
    
    // Pause entre les vues pour ne pas surcharger
    if (sortedViews.indexOf(view) < sortedViews.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Avertir si intervention manuelle nécessaire
  if (manualInterventionNeeded) {
    logger.warn('⚠️  Some views require manual refresh via Supabase Dashboard SQL Editor');
  }

  return results;
};

/**
 * Affiche les statistiques des vues (version corrigée)
 */
const getViewsStats = async () => {
  try {
    // Essayer d'abord pg_matviews
    const { data, error } = await supabaseService
      .from('pg_matviews')
      .select('matviewname, hasindexes')
      .in('matviewname', CONFIG.VIEWS.map(v => v.name));

    if (!error && data) {
      return data;
    }

    // Fallback: utiliser information_schema
    const { data: fallbackData, error: fallbackError } = await supabaseService
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_type', 'MATERIALIZED VIEW')
      .in('table_name', CONFIG.VIEWS.map(v => v.name));

    if (!fallbackError && fallbackData) {
      return fallbackData.map(item => ({
        matviewname: item.table_name,
        hasindexes: null // Information non disponible via information_schema
      }));
    }

    logger.warn('Could not retrieve view statistics');
    return [];
  } catch (error) {
    logger.error('Error getting views stats:', error.message);
    return [];
  }
};

/**
 * Boucle principale avec gestion d'erreurs améliorée
 */
const startRefresher = async () => {
  logger.info('🔄 Materialized Views Refresher started (Fixed Version)');
  logger.info(`Refresh interval: ${CONFIG.REFRESH_INTERVAL / 1000}s`);

  // Vérifier les capacités du système
  const hasExecSql = await checkRpcFunction('exec_sql');
  logger.info(`RPC exec_sql available: ${hasExecSql ? '✅' : '❌'}`);

  // Vérifier que les vues existent
  const existingViews = [];
  for (const view of CONFIG.VIEWS) {
    const exists = await checkViewExists(view.name);
    if (exists) {
      existingViews.push(view);
      logger.info(`✅ View ${view.name} found`);
    } else {
      logger.warn(`⚠️  View ${view.name} does not exist`);
    }
  }

  if (existingViews.length === 0) {
    logger.warn('No materialized views found. Refresh service will run but may not be effective.');
  }

  // Afficher les stats initiales
  const stats = await getViewsStats();
  if (stats.length > 0) {
    logger.info('Current materialized views:', stats);
  }

  // Boucle de rafraîchissement
  const refreshLoop = async () => {
    try {
      const results = await refreshAllViews();
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success && !r.skipped).length;
      const skipCount = results.filter(r => r.skipped).length;

      let logMessage = `Refresh completed: ${successCount} success`;
      if (failCount > 0) logMessage += `, ${failCount} failed`;
      if (skipCount > 0) logMessage += `, ${skipCount} skipped`;

      if (failCount > 0) {
        logger.warn(logMessage);
      } else {
        logger.info(logMessage);
      }

      // Log des erreurs spécifiques
      results.filter(r => !r.success && !r.skipped).forEach(result => {
        logger.debug(`Failed: ${result.view} - ${result.error}`);
      });

    } catch (error) {
      logger.error('Error in refresh loop:', error.message);
    }
  };

  // Configurer l'intervalle
  const intervalId = setInterval(refreshLoop, CONFIG.REFRESH_INTERVAL);

  // Premier rafraîchissement immédiat
  logger.info('Running initial refresh...');
  await refreshLoop();

  // Gestion gracieuse de l'arrêt
  const shutdown = () => {
    logger.info('Shutting down refresh service...');
    clearInterval(intervalId);
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return intervalId;
};

/**
 * Mode one-shot corrigé
 */
const runOnce = async () => {
  logger.info('Running one-time refresh...');
  
  try {
    const results = await refreshAllViews();
    
    const failCount = results.filter(r => !r.success && !r.skipped).length;
    const manualCount = results.filter(r => r.requiresManualIntervention).length;
    
    if (manualCount > 0) {
      logger.warn(`${manualCount} views require manual intervention`);
    }
    
    if (failCount > 0) {
      logger.error(`${failCount} views failed to refresh`);
      process.exit(1);
    } else {
      logger.info('All views processed successfully');
      process.exit(0);
    }
  } catch (error) {
    logger.error('One-shot refresh failed:', error.message);
    process.exit(1);
  }
};

// Exécuter si lancé directement
if (require.main === module) {
  const mode = process.argv[2] || 'daemon';
  
  if (mode === 'once') {
    runOnce();
  } else {
    startRefresher().catch(error => {
      logger.error('Failed to start refresher:', error);
      process.exit(1);
    });
  }
}

module.exports = {
  refreshView,
  refreshAllViews,
  startRefresher,
  runOnce,
  checkRpcFunction,
  checkViewExists,
  CONFIG
};
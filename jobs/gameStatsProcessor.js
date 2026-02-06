/**
 * Game Stats Processor
 * 
 * Job asynchrone pour calculer les statistiques des jeux.
 * Remplace le trigger synchrone coûteux.
 * 
 * Usage: node jobs/gameStatsProcessor.js
 * Ou avec PM2: pm2 start jobs/gameStatsProcessor.js --name game-stats-processor
 */

const { supabaseService } = require('../config/supabase');
const logger = require('../utils/logger');

const CONFIG = {
  // Intervalle entre chaque batch de traitement (ms)
  PROCESS_INTERVAL: 5000,
  
  // Nombre de jobs à traiter par batch
  BATCH_SIZE: 10,
  
  // Nombre maximum de retries
  MAX_RETRIES: 3,
  
  // Délai avant de reconsidérer un job failed (ms)
  RETRY_DELAY: 60000
};

/**
 * Calcule les statistiques d'un jeu
 */
const calculateGameStats = async (gameId) => {
  const startTime = Date.now();
  
  try {
    // Compter les joueurs uniques
    const { data: playerData, error: playerError } = await supabaseService
      .from('game_participations')
      .select('guest_id', { count: 'exact', head: false })
      .eq('game_id', gameId);

    if (playerError) throw playerError;

    const uniquePlayers = new Set(playerData?.map(p => p.guest_id) || []);
    const playersCount = uniquePlayers.size;

    // Calculer le score moyen (uniquement les participations terminées)
    const { data: scoreData, error: scoreError } = await supabaseService
      .from('game_participations')
      .select('total_score')
      .eq('game_id', gameId)
      .eq('is_completed', true);

    if (scoreError) throw scoreError;

    const avgScore = scoreData?.length > 0
      ? scoreData.reduce((sum, p) => sum + p.total_score, 0) / scoreData.length
      : 0;

    // Mettre à jour les stats du jeu
    const { error: updateError } = await supabaseService
      .from('games')
      .update({
        players_count: playersCount,
        avg_score: Math.round(avgScore * 100) / 100, // 2 décimales
        updated_at: new Date().toISOString()
      })
      .eq('id', gameId);

    if (updateError) throw updateError;

    const duration = Date.now() - startTime;
    logger.info(`✅ Game stats updated for ${gameId}`, {
      gameId,
      playersCount,
      avgScore,
      duration: `${duration}ms`
    });

    return { success: true, playersCount, avgScore };
  } catch (error) {
    logger.error(`❌ Failed to calculate stats for game ${gameId}:`, error.message);
    throw error;
  }
};

/**
 * Récupère les jobs en attente
 */
const fetchPendingJobs = async () => {
  const { data, error } = await supabaseService
    .from('game_stats_update_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(CONFIG.BATCH_SIZE);

  if (error) {
    logger.error('Error fetching pending jobs:', error.message);
    return [];
  }

  return data || [];
};

/**
 * Marque un job comme en cours de traitement
 */
const markJobAsProcessing = async (jobId) => {
  const { error } = await supabaseService
    .from('game_stats_update_jobs')
    .update({ status: 'processing' })
    .eq('id', jobId);

  if (error) {
    logger.error(`Error marking job ${jobId} as processing:`, error.message);
  }
};

/**
 * Marque un job comme complété
 */
const markJobAsCompleted = async (jobId) => {
  const { error } = await supabaseService
    .from('game_stats_update_jobs')
    .update({
      status: 'completed',
      processed_at: new Date().toISOString()
    })
    .eq('id', jobId);

  if (error) {
    logger.error(`Error marking job ${jobId} as completed:`, error.message);
  }
};

/**
 * Marque un job comme échoué
 */
const markJobAsFailed = async (jobId, errorMessage, retryCount) => {
  const shouldRetry = retryCount < CONFIG.MAX_RETRIES;

  const { error } = await supabaseService
    .from('game_stats_update_jobs')
    .update({
      status: shouldRetry ? 'pending' : 'failed',
      error_message: errorMessage,
      retry_count: retryCount + 1,
      // Si on retry, on décale le created_at pour ne pas le reprendre tout de suite
      created_at: shouldRetry 
        ? new Date(Date.now() + CONFIG.RETRY_DELAY).toISOString()
        : new Date().toISOString()
    })
    .eq('id', jobId);

  if (error) {
    logger.error(`Error marking job ${jobId} as failed:`, error.message);
  }

  if (!shouldRetry) {
    logger.error(`Job ${jobId} failed permanently after ${CONFIG.MAX_RETRIES} retries`);
  }
};

/**
 * Nettoie les vieux jobs complétés
 */
const cleanupOldJobs = async () => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7); // Garder 7 jours d'historique

  const { error } = await supabaseService
    .from('game_stats_update_jobs')
    .delete()
    .eq('status', 'completed')
    .lt('processed_at', cutoffDate.toISOString());

  if (error) {
    logger.error('Error cleaning up old jobs:', error.message);
  } else {
    logger.info('Cleaned up old completed jobs');
  }
};

/**
 * Traite un batch de jobs
 */
const processBatch = async () => {
  const jobs = await fetchPendingJobs();

  if (jobs.length === 0) {
    return; // Rien à faire
  }

  logger.info(`Processing ${jobs.length} game stats job(s)`);

  // Traiter les jobs en parallèle avec limite de concurrence
  const promises = jobs.map(async (job) => {
    try {
      // Marquer comme processing
      await markJobAsProcessing(job.id);

      // Calculer les stats
      await calculateGameStats(job.game_id);

      // Marquer comme complété
      await markJobAsCompleted(job.id);
    } catch (error) {
      await markJobAsFailed(job.id, error.message, job.retry_count || 0);
    }
  });

  await Promise.all(promises);
};

/**
 * Boucle principale
 */
const startProcessor = () => {
  logger.info('🚀 Game Stats Processor started');
  logger.info(`Configuration: ${JSON.stringify(CONFIG, null, 2)}`);

  let isRunning = false;

  const loop = async () => {
    if (isRunning) {
      logger.warn('Previous batch still running, skipping...');
      return;
    }

    isRunning = true;

    try {
      await processBatch();
      
      // Nettoyage périodique (une fois sur 20)
      if (Math.random() < 0.05) {
        await cleanupOldJobs();
      }
    } catch (error) {
      logger.error('Unexpected error in processor loop:', error);
    } finally {
      isRunning = false;
    }
  };

  // Démarrer la boucle
  setInterval(loop, CONFIG.PROCESS_INTERVAL);

  // Première exécution immédiate
  loop();

  // Gestion gracieuse de l'arrêt
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    process.exit(0);
  });
};

// Démarrer si exécuté directement
if (require.main === module) {
  startProcessor();
}

module.exports = {
  calculateGameStats,
  processBatch,
  startProcessor,
  CONFIG
};

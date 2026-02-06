#!/usr/bin/env node
/**
 * Script de test pour les corrections RPC Supabase
 * 
 * Vérifie que toutes les fonctions RPC fonctionnent correctement
 * et que les fallbacks marchent si les fonctions n'existent pas.
 */

const { supabaseService } = require('../config/supabase');
const logger = require('../utils/logger');
const eventDbOptimized = require('../utils/db/eventsOptimized.fixed');

// Couleurs pour la console
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const log = (color, symbol, message) => {
  console.log(`${colors[color]}${symbol} ${message}${colors.reset}`);
};

const success = (message) => log('green', '✅', message);
const error = (message) => log('red', '❌', message);
const warning = (message) => log('yellow', '⚠️ ', message);
const info = (message) => log('blue', 'ℹ️ ', message);
const title = (message) => console.log(`\n${colors.bold}${colors.blue}=== ${message} ===${colors.reset}\n`);

/**
 * Test 1: Vérifier la connexion Supabase
 */
const testSupabaseConnection = async () => {
  try {
    const { data, error } = await supabaseService
      .from('events')
      .select('id', { count: 'exact', head: true });

    if (error) throw error;
    
    success('Connexion Supabase établie');
    return true;
  } catch (err) {
    error(`Connexion Supabase échoué: ${err.message}`);
    return false;
  }
};

/**
 * Test 2: Vérifier les fonctions RPC
 */
const testRpcFunctions = async () => {
  const functions = [
    'exec_sql',
    'get_dashboard_summary', 
    'refresh_event_summary',
    'test_rpc_functions'
  ];

  const results = {};

  for (const func of functions) {
    try {
      // Tester l'existence via pg_proc
      const { data, error } = await supabaseService
        .from('pg_proc')
        .select('proname')
        .eq('proname', func)
        .single();

      if (error || !data) {
        results[func] = false;
        warning(`Fonction ${func} n'existe pas`);
      } else {
        results[func] = true;
        success(`Fonction ${func} trouvée`);
      }
    } catch (err) {
      results[func] = false;
      warning(`Impossible de vérifier ${func}: ${err.message}`);
    }
  }

  return results;
};

/**
 * Test 3: Tester la fonction test_rpc_functions si elle existe
 */
const testRpcFunctionsExecution = async () => {
  try {
    const { data, error } = await supabaseService.rpc('test_rpc_functions');
    
    if (error) {
      warning(`test_rpc_functions échoué: ${error.message}`);
      return false;
    }

    if (data && Array.isArray(data)) {
      info('Résultats de test_rpc_functions:');
      data.forEach(item => {
        const symbol = item.exists ? '✅' : '❌';
        console.log(`  ${symbol} ${item.function_name}: ${item.test_result}`);
      });
      return true;
    } else {
      warning('test_rpc_functions retourné des données inattendues');
      return false;
    }
  } catch (err) {
    warning(`test_rpc_functions inaccessible: ${err.message}`);
    return false;
  }
};

/**
 * Test 4: Tester get_dashboard_summary avec un utilisateur fictif
 */
const testDashboardSummary = async () => {
  try {
    // Utiliser un UUID fictif pour le test
    const fakeUserId = '00000000-0000-0000-0000-000000000000';
    
    const { data, error } = await supabaseService.rpc('get_dashboard_summary', {
      p_organizer_id: fakeUserId
    });

    if (error) {
      warning(`get_dashboard_summary échoué: ${error.message}`);
      
      // Tester le fallback
      info('Test du fallback getDashboardSummary...');
      const fallbackResult = await eventDbOptimized.getDashboardSummaryFallback(fakeUserId);
      
      if (fallbackResult && typeof fallbackResult === 'object') {
        success('Fallback getDashboardSummary fonctionne');
        console.log('  Résultat:', JSON.stringify(fallbackResult, null, 2));
        return true;
      } else {
        error('Fallback getDashboardSummary échoué');
        return false;
      }
    } else {
      success('get_dashboard_summary fonctionne');
      if (data) {
        console.log('  Résultat:', JSON.stringify(data, null, 2));
      }
      return true;
    }
  } catch (err) {
    error(`Test dashboard summary échoué: ${err.message}`);
    return false;
  }
};

/**
 * Test 5: Vérifier les vues matérialisées
 */
const testMaterializedViews = async () => {
  const views = ['mv_event_summary', 'mv_qr_code_stats', 'mv_game_stats'];
  const results = {};

  for (const view of views) {
    try {
      // Méthode 1: pg_matviews
      const { data, error } = await supabaseService
        .from('pg_matviews')
        .select('matviewname')
        .eq('matviewname', view)
        .single();

      if (!error && data) {
        results[view] = true;
        success(`Vue matérialisée ${view} trouvée`);
      } else {
        // Méthode 2: information_schema
        const { data: infoData, error: infoError } = await supabaseService
          .from('information_schema.tables')
          .select('table_name')
          .eq('table_name', view)
          .eq('table_type', 'MATERIALIZED VIEW')
          .single();

        if (!infoError && infoData) {
          results[view] = true;
          success(`Vue matérialisée ${view} trouvée (via information_schema)`);
        } else {
          results[view] = false;
          warning(`Vue matérialisée ${view} introuvable`);
        }
      }
    } catch (err) {
      results[view] = false;
      warning(`Erreur lors de la vérification de ${view}: ${err.message}`);
    }
  }

  return results;
};

/**
 * Test 6: Tester refresh_event_summary
 */
const testRefreshFunction = async () => {
  try {
    const { data, error } = await supabaseService.rpc('refresh_event_summary');
    
    if (error) {
      warning(`refresh_event_summary échoué: ${error.message}`);
      
      // Test du fallback
      info('Test du fallback refreshMaterializedView...');
      const result = await eventDbOptimized.refreshMaterializedView();
      
      if (result.success) {
        success(`Fallback refresh fonctionne (méthode: ${result.method})`);
        return true;
      } else {
        warning(`Fallback refresh échoué: ${result.error}`);
        if (result.message) {
          info(`Message: ${result.message}`);
        }
        return false;
      }
    } else {
      success('refresh_event_summary fonctionne');
      return true;
    }
  } catch (err) {
    error(`Test refresh échoué: ${err.message}`);
    return false;
  }
};

/**
 * Test 7: Tester les fallbacks du module eventsOptimized
 */
const testEventOptimizedFallbacks = async () => {
  const fakeUserId = '00000000-0000-0000-0000-000000000000';
  
  try {
    info('Test findByOrganizerWithStats...');
    const eventsResult = await eventDbOptimized.findByOrganizerWithStats(fakeUserId, {
      page: 1,
      limit: 10
    });
    
    if (eventsResult && eventsResult.events && Array.isArray(eventsResult.events)) {
      success('findByOrganizerWithStats fonctionne');
      console.log(`  Trouvé ${eventsResult.events.length} événements`);
    } else {
      warning('findByOrganizerWithStats retourné un format inattendu');
    }

    info('Test getDashboardSummary...');
    const dashboardResult = await eventDbOptimized.getDashboardSummary(fakeUserId);
    
    if (dashboardResult && typeof dashboardResult === 'object') {
      success('getDashboardSummary fonctionne');
      console.log('  Stats:', JSON.stringify(dashboardResult, null, 2));
    } else {
      warning('getDashboardSummary retourné un format inattendu');
    }

    return true;
  } catch (err) {
    error(`Test fallbacks échoué: ${err.message}`);
    return false;
  }
};

/**
 * Fonction principale
 */
const runTests = async () => {
  title('TESTS DE CORRECTION RPC SUPABASE');
  
  const results = {
    connection: false,
    rpcFunctions: {},
    rpcExecution: false,
    dashboardSummary: false,
    materializedViews: {},
    refreshFunction: false,
    fallbacks: false
  };

  // Test 1: Connexion
  title('1. Test de Connexion Supabase');
  results.connection = await testSupabaseConnection();

  if (!results.connection) {
    error('Connexion Supabase échouée. Arrêt des tests.');
    process.exit(1);
  }

  // Test 2: Fonctions RPC
  title('2. Vérification des Fonctions RPC');
  results.rpcFunctions = await testRpcFunctions();

  // Test 3: Exécution test_rpc_functions
  title('3. Test d\'Exécution des Fonctions');
  results.rpcExecution = await testRpcFunctionsExecution();

  // Test 4: Dashboard summary
  title('4. Test Dashboard Summary');
  results.dashboardSummary = await testDashboardSummary();

  // Test 5: Vues matérialisées
  title('5. Vérification des Vues Matérialisées');
  results.materializedViews = await testMaterializedViews();

  // Test 6: Refresh function
  title('6. Test Refresh Function');
  results.refreshFunction = await testRefreshFunction();

  // Test 7: Fallbacks
  title('7. Test des Fallbacks');
  results.fallbacks = await testEventOptimizedFallbacks();

  // Résumé
  title('RÉSUMÉ DES TESTS');
  
  const rpcCount = Object.values(results.rpcFunctions).filter(Boolean).length;
  const totalRpcFunctions = Object.keys(results.rpcFunctions).length;
  const viewCount = Object.values(results.materializedViews).filter(Boolean).length;
  const totalViews = Object.keys(results.materializedViews).length;

  console.log(`Connexion Supabase: ${results.connection ? '✅' : '❌'}`);
  console.log(`Fonctions RPC: ${rpcCount}/${totalRpcFunctions} disponibles`);
  console.log(`Exécution RPC: ${results.rpcExecution ? '✅' : '❌'}`);
  console.log(`Dashboard Summary: ${results.dashboardSummary ? '✅' : '❌'}`);
  console.log(`Vues matérialisées: ${viewCount}/${totalViews} disponibles`);
  console.log(`Fonction Refresh: ${results.refreshFunction ? '✅' : '❌'}`);
  console.log(`Fallbacks: ${results.fallbacks ? '✅' : '❌'}`);

  // Recommandations
  title('RECOMMANDATIONS');

  if (rpcCount < totalRpcFunctions) {
    info('Pour créer les fonctions manquantes:');
    info('1. Aller dans Supabase Dashboard → SQL Editor');
    info('2. Exécuter le script: backend/migrations/001_create_rpc_functions.sql');
  }

  if (viewCount < totalViews) {
    info('Certaines vues matérialisées sont manquantes. Elles seront créées automatiquement lors de la première utilisation.');
  }

  if (results.fallbacks) {
    success('Les fallbacks fonctionnent - l\'application peut fonctionner même sans les fonctions RPC');
  }

  // Code de sortie
  const critical = results.connection && results.fallbacks;
  if (critical) {
    success('Tests critiques réussis - l\'application peut fonctionner');
    process.exit(0);
  } else {
    error('Tests critiques échoués');
    process.exit(1);
  }
};

// Gestion des erreurs non capturées
process.on('unhandledRejection', (err) => {
  error(`Erreur non gérée: ${err.message}`);
  process.exit(1);
});

// Exécuter les tests
if (require.main === module) {
  runTests().catch(err => {
    error(`Erreur lors des tests: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  testSupabaseConnection,
  testRpcFunctions,
  testDashboardSummary,
  testMaterializedViews,
  runTests
};
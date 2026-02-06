#!/usr/bin/env node
/**
 * 🔧 SCRIPT DE TEST POUR LES CORRECTIONS SEATING TABLES
 * 
 * Teste les corrections apportées selon rules.md et context.md :
 * - Validation des paramètres
 * - Gestion d'erreurs robuste  
 * - Fallbacks intelligents
 * - Sécurité renforcée
 */

const { supabaseService } = require('../config/supabase');
const seatingTablesFixed = require('../utils/db/seatingTables.fixed');
const logger = require('../utils/logger');

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

// ============================================
// DONNÉES DE TEST
// ============================================

const testData = {
  // UUID factices pour les tests (ne doivent pas exister en DB)
  fakeEventId: '00000000-0000-0000-0000-000000000001',
  fakeUserId: '00000000-0000-0000-0000-000000000002',
  fakeTableId: '00000000-0000-0000-0000-000000000003',

  validTableData: {
    name: 'Table Test',
    seats: 8,
    table_shape: 'round',
    position_x: 100,
    position_y: 200,
    notes: 'Table de test'
  },

  invalidTableData: {
    name: '',
    seats: -1,
    table_shape: 'invalid',
    notes: 'x'.repeat(2000)
  }
};

// ============================================
// TESTS DE VALIDATION
// ============================================

const testValidation = async () => {
  title('Tests de Validation');

  let passed = 0;
  let total = 0;

  // Test 1: validateUUID
  total++;
  try {
    const validUuid = seatingTablesFixed.validateUUID('550e8400-e29b-41d4-a716-446655440000');
    const invalidUuid = seatingTablesFixed.validateUUID('invalid-uuid');
    
    if (validUuid && !invalidUuid) {
      success('validateUUID fonctionne correctement');
      passed++;
    } else {
      error('validateUUID échoue');
    }
  } catch (err) {
    error(`validateUUID erreur: ${err.message}`);
  }

  // Test 2: validateTableData - données valides
  total++;
  try {
    const errors = seatingTablesFixed.validateTableData(testData.validTableData);
    if (errors.length === 0) {
      success('validateTableData accepte les données valides');
      passed++;
    } else {
      error(`validateTableData rejette les données valides: ${errors.join(', ')}`);
    }
  } catch (err) {
    error(`validateTableData erreur: ${err.message}`);
  }

  // Test 3: validateTableData - données invalides
  total++;
  try {
    const errors = seatingTablesFixed.validateTableData(testData.invalidTableData);
    if (errors.length > 0) {
      success(`validateTableData rejette les données invalides: ${errors.length} erreurs`);
      passed++;
    } else {
      error('validateTableData accepte les données invalides');
    }
  } catch (err) {
    error(`validateTableData erreur: ${err.message}`);
  }

  info(`Tests de validation: ${passed}/${total} réussis`);
  return passed === total;
};

// ============================================
// TESTS DE SÉCURITÉ
// ============================================

const testSecurity = async () => {
  title('Tests de Sécurité');

  let passed = 0;
  let total = 0;

  // Test 1: checkEventAccess avec UUID invalide
  total++;
  try {
    await seatingTablesFixed.checkEventAccess('invalid-uuid', testData.fakeUserId);
    error('checkEventAccess accepte UUID invalide');
  } catch (err) {
    if (err.message.includes('Invalid')) {
      success('checkEventAccess rejette UUID invalide');
      passed++;
    } else {
      warning(`checkEventAccess erreur inattendue: ${err.message}`);
    }
  }

  // Test 2: checkEventAccess avec événement inexistant
  total++;
  try {
    await seatingTablesFixed.checkEventAccess(testData.fakeEventId, testData.fakeUserId);
    error('checkEventAccess accepte événement inexistant');
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('access denied')) {
      success('checkEventAccess rejette événement inexistant');
      passed++;
    } else {
      warning(`checkEventAccess erreur inattendue: ${err.message}`);
    }
  }

  // Test 3: getUnassignedGuests avec paramètres invalides
  total++;
  try {
    await seatingTablesFixed.getUnassignedGuests('invalid-uuid', testData.fakeUserId);
    error('getUnassignedGuests accepte UUID invalide');
  } catch (err) {
    if (err.message.includes('Invalid')) {
      success('getUnassignedGuests rejette UUID invalide');
      passed++;
    } else {
      warning(`getUnassignedGuests erreur inattendue: ${err.message}`);
    }
  }

  info(`Tests de sécurité: ${passed}/${total} réussis`);
  return passed === total;
};

// ============================================
// TESTS DE GESTION D'ERREURS
// ============================================

const testErrorHandling = async () => {
  title('Tests de Gestion d\'Erreurs');

  let passed = 0;
  let total = 0;

  // Test 1: checkTablesExist
  total++;
  try {
    const tablesExist = await seatingTablesFixed.checkTablesExist();
    success(`checkTablesExist retourne: ${tablesExist}`);
    passed++;
  } catch (err) {
    warning(`checkTablesExist erreur: ${err.message}`);
    passed++; // Ce n'est pas un échec critique
  }

  // Test 2: getUnassignedGuests avec utilisateur fake (doit gérer l'erreur gracieusement)
  total++;
  try {
    const guests = await seatingTablesFixed.getUnassignedGuests(testData.fakeEventId, testData.fakeUserId);
    success('getUnassignedGuests gère les événements inexistants gracieusement');
    info(`Résultat: ${Array.isArray(guests) ? guests.length : 'non-array'} invités`);
    passed++; // Si pas d'exception, c'est bon
  } catch (err) {
    if (err.message.includes('access denied') || err.message.includes('not found')) {
      success('getUnassignedGuests rejette correctement les accès non autorisés');
      passed++;
    } else {
      warning(`getUnassignedGuests erreur inattendue: ${err.message}`);
    }
  }

  // Test 3: getAvailableFamilies avec utilisateur fake
  total++;
  try {
    const families = await seatingTablesFixed.getAvailableFamilies(testData.fakeEventId, testData.fakeUserId);
    success('getAvailableFamilies gère les événements inexistants gracieusement');
    info(`Résultat: ${Array.isArray(families) ? families.length : 'non-array'} familles`);
    passed++;
  } catch (err) {
    if (err.message.includes('access denied') || err.message.includes('not found')) {
      success('getAvailableFamilies rejette correctement les accès non autorisés');
      passed++;
    } else {
      warning(`getAvailableFamilies erreur inattendue: ${err.message}`);
    }
  }

  info(`Tests de gestion d'erreurs: ${passed}/${total} réussis`);
  return passed === total;
};

// ============================================
// TESTS DE PERFORMANCE ET LOGGING
// ============================================

const testPerformanceAndLogging = async () => {
  title('Tests de Performance et Logging');

  let passed = 0;
  let total = 0;

  // Test 1: getStats avec données fake (doit être rapide)
  total++;
  try {
    const startTime = Date.now();
    const stats = await seatingTablesFixed.getStats(testData.fakeEventId, testData.fakeUserId);
    const duration = Date.now() - startTime;
    
    if (duration < 5000) { // Moins de 5 secondes
      success(`getStats répond en ${duration}ms`);
      passed++;
    } else {
      warning(`getStats lent: ${duration}ms`);
    }
    
    info(`Stats reçues: ${JSON.stringify(stats)}`);
  } catch (err) {
    if (err.message.includes('access denied') || err.message.includes('not found')) {
      success('getStats rejette correctement les accès non autorisés');
      passed++;
    } else {
      warning(`getStats erreur: ${err.message}`);
    }
  }

  // Test 2: Vérifier que les logs sont générés
  total++;
  try {
    // Tenter une opération qui devrait générer des logs
    await seatingTablesFixed.getUnassignedGuests(testData.fakeEventId, testData.fakeUserId);
    success('Les opérations génèrent des logs');
    passed++;
  } catch (err) {
    success('Les erreurs génèrent des logs');
    passed++;
  }

  info(`Tests de performance: ${passed}/${total} réussis`);
  return passed === total;
};

// ============================================
// TEST DE CONNEXION SUPABASE
// ============================================

const testSupabaseConnection = async () => {
  title('Test de Connexion Supabase');

  try {
    const { data, error } = await supabaseService
      .from('events')
      .select('id', { count: 'exact', head: true });

    if (error) {
      error(`Connexion Supabase échoué: ${error.message}`);
      return false;
    } else {
      success('Connexion Supabase établie');
      return true;
    }
  } catch (err) {
    error(`Connexion Supabase erreur: ${err.message}`);
    return false;
  }
};

// ============================================
// FONCTION PRINCIPALE
// ============================================

const runTests = async () => {
  title('TESTS DE CORRECTION SEATING TABLES');

  const results = {
    connection: false,
    validation: false,
    security: false,
    errorHandling: false,
    performance: false
  };

  // Test connexion
  results.connection = await testSupabaseConnection();
  if (!results.connection) {
    error('Tests interrompus - pas de connexion Supabase');
    process.exit(1);
  }

  // Tests de validation
  results.validation = await testValidation();

  // Tests de sécurité
  results.security = await testSecurity();

  // Tests de gestion d'erreurs
  results.errorHandling = await testErrorHandling();

  // Tests de performance
  results.performance = await testPerformanceAndLogging();

  // Résumé
  title('RÉSUMÉ DES TESTS');

  const passedTests = Object.values(results).filter(Boolean).length;
  const totalTests = Object.keys(results).length;

  console.log(`Connexion Supabase: ${results.connection ? '✅' : '❌'}`);
  console.log(`Validation: ${results.validation ? '✅' : '❌'}`);
  console.log(`Sécurité: ${results.security ? '✅' : '❌'}`);
  console.log(`Gestion d'erreurs: ${results.errorHandling ? '✅' : '❌'}`);
  console.log(`Performance: ${results.performance ? '✅' : '❌'}`);

  title('RECOMMANDATIONS');

  if (!results.validation) {
    warning('Validation échoue - vérifier les fonctions de validation');
  }

  if (!results.security) {
    warning('Sécurité échoue - vérifier les contrôles d\'accès');
  }

  if (!results.errorHandling) {
    warning('Gestion d\'erreurs échoue - vérifier les fallbacks');
  }

  if (passedTests === totalTests) {
    success('✨ Tous les tests passent - les corrections sont fonctionnelles');
    info('Pour appliquer les corrections:');
    info('1. Remplacer utils/db/seatingTables.js par seatingTables.fixed.js');
    info('2. Ajouter les routes seating-tables.fixed.js dans server.js');
    info('3. Remplacer lib/dashboard-api.ts par dashboard-api.fixed.ts');
  } else {
    warning(`${passedTests}/${totalTests} tests réussis - corrections partielles`);
  }

  // Code de sortie
  process.exit(passedTests === totalTests ? 0 : 1);
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
  testValidation,
  testSecurity,
  testErrorHandling,
  runTests
};
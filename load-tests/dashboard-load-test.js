/**
 * Dashboard Load Test
 * 
 * Teste les performances du dashboard sous charge.
 * 
 * Usage:
 *   k6 run dashboard-load-test.js
 *   k6 run --vus 100 --duration 5m dashboard-load-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Métriques personnalisées
const errorRate = new Rate('errors');
const dashboardLoadTime = new Trend('dashboard_load_time');
const apiLatency = new Trend('api_latency');
const cacheHitRate = new Rate('cache_hits');

// Configuration du test
export const options = {
  stages: [
    { duration: '2m', target: 50 },    // Ramp up to 50 users
    { duration: '5m', target: 50 },    // Stay at 50 users
    { duration: '2m', target: 100 },   // Ramp up to 100 users
    { duration: '5m', target: 100 },   // Stay at 100 users
    { duration: '2m', target: 200 },   // Ramp up to 200 users
    { duration: '5m', target: 200 },   // Stay at 200 users
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95% des requêtes < 500ms
    http_req_failed: ['rate<0.01'],      // Taux d'erreur < 1%
    dashboard_load_time: ['p(95)<400'],  // Dashboard < 400ms
    errors: ['rate<0.05'],               // Erreurs < 5%
  },
};

// Configuration API
const API_URL = __ENV.API_URL || 'http://localhost:5000/api';
const AUTH_TOKEN = __ENV.AUTH_TOKEN; // À définir en variable d'environnement

// Données de test
const EVENT_ID = __ENV.TEST_EVENT_ID || 'test-event-id';

/**
 * Setup: Exécuté une fois avant le test
 */
export function setup() {
  console.log('🔧 Test Configuration:');
  console.log(`   API URL: ${API_URL}`);
  console.log(`   Target Event: ${EVENT_ID}`);
  
  // Vérifier que l'API est accessible
  const healthCheck = http.get(`${API_URL}/health`);
  if (healthCheck.status !== 200) {
    throw new Error('API is not accessible');
  }
  
  return { apiUrl: API_URL, eventId: EVENT_ID };
}

/**
 * Test du Dashboard Summary
 */
function testDashboardSummary(authHeaders) {
  group('Dashboard Summary', () => {
    const startTime = new Date();
    
    const response = http.get(`${API_URL}/dashboard/summary`, {
      headers: authHeaders,
    });
    
    const duration = new Date() - startTime;
    dashboardLoadTime.add(duration);
    apiLatency.add(response.timings.waiting);
    
    const success = check(response, {
      'dashboard status is 200': (r) => r.status === 200,
      'dashboard response time < 500ms': (r) => r.timings.duration < 500,
      'dashboard has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.success === true;
        } catch (e) {
          return false;
        }
      },
    });
    
    errorRate.add(!success);
    
    if (!success) {
      console.error(`❌ Dashboard failed: ${response.status} - ${response.body}`);
    }
  });
}

/**
 * Test de la liste des events
 */
function testEventsList(authHeaders) {
  group('Events List', () => {
    const response = http.get(`${API_URL}/events`, {
      headers: authHeaders,
    });
    
    const success = check(response, {
      'events status is 200': (r) => r.status === 200,
      'events response time < 300ms': (r) => r.timings.duration < 300,
      'events returns array': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body.data);
        } catch (e) {
          return false;
        }
      },
    });
    
    errorRate.add(!success);
  });
}

/**
 * Test de la liste des guests (avec pagination)
 */
function testGuestsList(authHeaders, eventId) {
  group('Guests List', () => {
    const response = http.get(`${API_URL}/events/${eventId}/guests?page=1&limit=50`, {
      headers: authHeaders,
    });
    
    const success = check(response, {
      'guests status is 200': (r) => r.status === 200,
      'guests response time < 400ms': (r) => r.timings.duration < 400,
      'guests has pagination': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data !== undefined && body.count !== undefined;
        } catch (e) {
          return false;
        }
      },
    });
    
    errorRate.add(!success);
  });
}

/**
 * Test de validation QR Code
 */
function testQRValidation(authHeaders, eventId) {
  group('QR Validation', () => {
    // Simuler un scan de QR code
    const testQRCode = 'TEST123456';
    
    const response = http.post(
      `${API_URL}/verify-qr/${testQRCode}`,
      {},
      { headers: authHeaders }
    );
    
    // On accepte 200 (succès) ou 400 (QR invalide) mais pas 500 (erreur serveur)
    const success = check(response, {
      'qr validation status is 200 or 400': (r) => r.status === 200 || r.status === 400,
      'qr validation response time < 200ms': (r) => r.timings.duration < 200,
    });
    
    errorRate.add(!success);
  });
}

/**
 * Test de l'upload de fichier (petit fichier)
 */
function testFileUpload(authHeaders) {
  group('File Upload', () => {
    // Créer un petit blob simulant une image
    const fileData = {
      file: http.file(new Uint8Array(1024), 'test.jpg', 'image/jpeg'),
    };
    
    const response = http.post(`${API_URL}/upload`, fileData, {
      headers: authHeaders,
    });
    
    const success = check(response, {
      'upload status is 200 or 201': (r) => r.status === 200 || r.status === 201,
      'upload response time < 2000ms': (r) => r.timings.duration < 2000,
    });
    
    errorRate.add(!success);
  });
}

/**
 * Scénario principal
 */
export default function(data) {
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`,
    'X-Test-Run': 'true',
  };

  // Simuler un comportement utilisateur réaliste
  
  // 1. Charger le dashboard (100% des users)
  testDashboardSummary(authHeaders);
  sleep(Math.random() * 2 + 1); // 1-3s
  
  // 2. Charger la liste des events (80% des users)
  if (Math.random() < 0.8) {
    testEventsList(authHeaders);
    sleep(Math.random() * 2 + 0.5);
  }
  
  // 3. Charger les guests (60% des users)
  if (Math.random() < 0.6) {
    testGuestsList(authHeaders, data.eventId);
    sleep(Math.random() * 3 + 1);
  }
  
  // 4. Valider un QR (20% des users - simule les scans)
  if (Math.random() < 0.2) {
    testQRValidation(authHeaders, data.eventId);
    sleep(Math.random() * 1 + 0.5);
  }
  
  // 5. Upload de fichier (5% des users)
  if (Math.random() < 0.05) {
    testFileUpload(authHeaders);
    sleep(Math.random() * 5 + 2);
  }
  
  // Pause entre les itérations
  sleep(Math.random() * 3 + 2);
}

/**
 * Teardown: Exécuté une fois après le test
 */
export function teardown(data) {
  console.log('\n📊 Test Summary:');
  console.log(`   Target API: ${data.apiUrl}`);
  console.log('   Check console for detailed metrics');
}

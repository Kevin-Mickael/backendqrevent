/**
 * Game Participation Load Test
 * 
 * Teste les performances du système de jeux sous charge intensive.
 * Simule des centaines de joueurs répondant simultanément.
 * 
 * Usage:
 *   k6 run game-load-test.js
 *   k6 run --vus 500 --duration 10m game-load-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Métriques personnalisées
const errorRate = new Rate('errors');
const submitAnswerTime = new Trend('submit_answer_time');
const joinGameTime = new Trend('join_game_time');
const getLeaderboardTime = new Trend('get_leaderboard_time');

// Configuration du test - Simulation massive
export const options = {
  scenarios: {
    // Scénario 1: Ramp up progressif
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },   // 100 joueurs
        { duration: '2m', target: 300 },   // 300 joueurs
        { duration: '2m', target: 500 },   // 500 joueurs
        { duration: '5m', target: 500 },   // Maintien
        { duration: '2m', target: 0 },     // Ramp down
      ],
      gracefulRampDown: '30s',
    },
    
    // Scénario 2: Spike test (test de résilience)
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '30s', target: 1000 }, // Spike soudain
        { duration: '5m', target: 1000 },   // Maintien
        { duration: '2m', target: 0 },
      ],
      startTime: '15m', // Démarre après le premier scénario
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300'],      // API < 300ms
    submit_answer_time: ['p(95)<200'],     // Submit réponse < 200ms
    join_game_time: ['p(95)<400'],         // Join game < 400ms
    errors: ['rate<0.02'],                  // Erreurs < 2%
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:5000/api';
const GAME_ID = __ENV.TEST_GAME_ID || 'test-game-id';
const EVENT_ID = __ENV.TEST_EVENT_ID || 'test-event-id';

/**
 * Setup
 */
export function setup() {
  console.log('🎮 Game Load Test Setup');
  console.log(`   Game ID: ${GAME_ID}`);
  console.log(`   Target: ${API_URL}`);
  
  return { gameId: GAME_ID, eventId: EVENT_ID };
}

/**
 * Rejoindre un jeu
 */
function joinGame(gameId, guestId) {
  group('Join Game', () => {
    const payload = JSON.stringify({
      guestId: guestId,
    });
    
    const startTime = new Date();
    
    const response = http.post(
      `${API_URL}/games/${gameId}/join`,
      payload,
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
    
    const duration = new Date() - startTime;
    joinGameTime.add(duration);
    
    const success = check(response, {
      'join game status is 200 or 201': (r) => r.status === 200 || r.status === 201,
      'join game response time < 500ms': (r) => r.timings.duration < 500,
    });
    
    errorRate.add(!success);
    
    return success;
  });
}

/**
 * Récupérer les questions
 */
function getQuestions(gameId) {
  group('Get Questions', () => {
    const response = http.get(`${API_URL}/games/${gameId}/questions`);
    
    check(response, {
      'get questions status is 200': (r) => r.status === 200,
      'get questions response time < 300ms': (r) => r.timings.duration < 300,
    });
    
    if (response.status === 200) {
      try {
        return JSON.parse(response.body).data || [];
      } catch (e) {
        return [];
      }
    }
    return [];
  });
}

/**
 * Soumettre une réponse
 */
function submitAnswer(gameId, questionId, guestId, answer) {
  group('Submit Answer', () => {
    const payload = JSON.stringify({
      guestId: guestId,
      questionId: questionId,
      answer: answer,
    });
    
    const startTime = new Date();
    
    const response = http.post(
      `${API_URL}/games/${gameId}/answers`,
      payload,
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
    
    const duration = new Date() - startTime;
    submitAnswerTime.add(duration);
    
    const success = check(response, {
      'submit answer status is 200': (r) => r.status === 200,
      'submit answer response time < 200ms': (r) => r.timings.duration < 200,
    });
    
    errorRate.add(!success);
    
    return success;
  });
}

/**
 * Récupérer le leaderboard
 */
function getLeaderboard(gameId) {
  group('Get Leaderboard', () => {
    const startTime = new Date();
    
    const response = http.get(`${API_URL}/games/${gameId}/leaderboard`);
    
    const duration = new Date() - startTime;
    getLeaderboardTime.add(duration);
    
    check(response, {
      'leaderboard status is 200': (r) => r.status === 200,
      'leaderboard response time < 400ms': (r) => r.timings.duration < 400,
    });
  });
}

/**
 * Scénario principal
 */
export default function(data) {
  // Générer un ID de guest unique par VU (Virtual User)
  const guestId = `guest-${__VU}-${Date.now()}`;
  const gameId = data.gameId;
  
  // 1. Rejoindre le jeu
  const joined = joinGame(gameId, guestId);
  if (!joined) {
    sleep(1);
    return; // Arrêter si on ne peut pas rejoindre
  }
  
  sleep(Math.random() * 2 + 0.5);
  
  // 2. Récupérer les questions
  const questions = getQuestions(gameId);
  
  sleep(Math.random() * 1 + 0.5);
  
  // 3. Répondre aux questions (simuler un joueur qui répond à tout)
  if (questions.length > 0) {
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      
      // Simuler le temps de réflexion (2-10 secondes)
      sleep(Math.random() * 8 + 2);
      
      // Répondre
      const answer = Math.floor(Math.random() * 4); // Réponse aléatoire 0-3
      submitAnswer(gameId, question.id, guestId, answer);
      
      // Vérifier le leaderboard de temps en temps (20% des questions)
      if (Math.random() < 0.2) {
        getLeaderboard(gameId);
      }
    }
  }
  
  // 4. Récupérer le score final
  getLeaderboard(gameId);
  
  // Pause avant prochaine itération
  sleep(Math.random() * 5 + 5);
}

export function teardown(data) {
  console.log('\n🎮 Game Load Test Complete');
  console.log('   Check k6 summary for detailed metrics');
}

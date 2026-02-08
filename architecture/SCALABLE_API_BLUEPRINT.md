# 🏗️ Architecture API Scalable - QR Event

## Vue d'ensemble

Architecture moderne basée sur les patterns Domain-Driven Design (DDD) et CQRS pour gérer la montée en charge jusqu'à 100k+ utilisateurs simultanés.

## 🎯 Principes de conception

### 1. **Séparation des responsabilités (SOLID)**
```
routes/ (Interface Layer)
├── controllers/ (Request/Response handling)
├── services/ (Business Logic)  
├── repositories/ (Data Access)
└── middleware/ (Cross-cutting concerns)
```

### 2. **CQRS Pattern (Command Query Responsibility Segregation)**
- **Commands**: Mutations (POST, PUT, DELETE)
- **Queries**: Lecture optimisée (GET)
- **Event Sourcing**: Pour l'audit des QR codes

### 3. **Cache Multi-niveau intelligent**
```
L1: Memory Cache (Redis) - 50ms
L2: Database Views - 200ms  
L3: CDN Edge Cache - 20ms
```

## 📐 Structure proposée

### **Nouvelle organisation des dossiers:**
```
src/
├── api/
│   ├── controllers/
│   │   ├── events.controller.js
│   │   ├── games.controller.js
│   │   └── guests.controller.js
│   ├── services/
│   │   ├── events.service.js (logique métier)
│   │   ├── games.service.js
│   │   └── cache.service.js
│   ├── repositories/
│   │   ├── events.repository.js (accès données)
│   │   └── games.repository.js
│   └── middleware/
│       ├── rateLimiter.adaptive.js
│       ├── cache.intelligent.js
│       └── pagination.advanced.js
├── domain/
│   ├── entities/ (modèles métier)
│   └── events/ (event sourcing)
└── infrastructure/
    ├── database/
    └── cache/
```

## 🚀 Optimisations critiques

### 1. **Élimination des requêtes N+1**

#### Avant (Problématique):
```javascript
// 🚨 N+1 Problem dans games-public.js:582
const leaderboard = await Promise.all(participations.map(async (entry) => {
  if (entry.family_id) {
    const family = await supabaseService.from('families')... // 1 requête par famille
  }
  if (entry.guest_id) {
    const guest = await supabaseService.from('guests')...   // 1 requête par invité
  }
}));
```

#### Après (Optimisé):
```javascript
// ✅ 1 seule requête avec jointures
const leaderboard = await supabaseService
  .from('game_participations')
  .select(`
    *,
    families(name),
    guests(first_name, last_name)
  `)
  .eq('game_id', gameId)
  .eq('is_completed', true)
  .order('total_score', { ascending: false });
```

### 2. **Pagination intelligente**

```javascript
// Cursor-based pagination (plus performant que OFFSET)
class PaginationService {
  static async getCursorBasedResults(table, cursor, limit = 20, orderBy = 'created_at') {
    const query = supabaseService
      .from(table)
      .select('*')
      .order(orderBy, { ascending: false })
      .limit(limit);
    
    if (cursor) {
      query.lt(orderBy, cursor);
    }
    
    return query;
  }
}
```

### 3. **Rate Limiting adaptatif**

```javascript
// Rate limiting intelligent par type d'utilisateur
class AdaptiveRateLimiter {
  static getUserTier(req) {
    if (req.user?.role === 'premium') return { rpm: 1000, concurrent: 50 };
    if (req.user?.id) return { rpm: 200, concurrent: 10 };
    return { rpm: 60, concurrent: 5 }; // Anonymous
  }
  
  static async checkLimit(req, res, next) {
    const tier = this.getUserTier(req);
    const key = `rate:${req.ip}:${req.user?.id || 'anon'}`;
    
    const current = await redis.incr(key);
    if (current === 1) await redis.expire(key, 60);
    
    if (current > tier.rpm) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: await redis.ttl(key)
      });
    }
    
    next();
  }
}
```

## 🧠 Cache Intelligent Multi-Niveau

### **Stratégie de cache probabiliste:**
```javascript
class IntelligentCacheService {
  // Cache avec TTL probabiliste pour éviter les cache stampedes
  static async get(key, fetchFn, baseTtl = 300) {
    let cached = await redis.get(key);
    
    if (cached) {
      const data = JSON.parse(cached);
      
      // Probabilistic early expiration (Beta * TTL)
      const beta = 1;
      const timeLeft = await redis.ttl(key);
      const xfetch = Math.random() * beta * Math.log(Date.now() / 1000);
      
      if (timeLeft > xfetch) {
        return data;
      }
      
      // Refresh asynchronously while returning stale data
      this.refreshAsync(key, fetchFn, baseTtl);
      return data;
    }
    
    // Cache miss - fetch and store
    const fresh = await fetchFn();
    await redis.setex(key, baseTtl, JSON.stringify(fresh));
    return fresh;
  }
}
```

### **Cache par pattern d'usage:**
```javascript
const CachePatterns = {
  STATIC: { ttl: 3600, tier: 'L3' },     // Settings, game configs
  FREQUENT: { ttl: 300, tier: 'L1' },    // User profiles, events
  REALTIME: { ttl: 30, tier: 'L1' },     // Leaderboards, live games
  COMPUTED: { ttl: 600, tier: 'L2' },    // Dashboard stats, reports
};
```

## 🔄 Architecture Asynchrone

### **Event-Driven avec Bull Queue:**
```javascript
// Queue pour traitement asynchrone
const gameEventQueue = new Bull('game-events', {
  redis: { port: 6379, host: 'localhost' }
});

// Traitement asynchrone du leaderboard
gameEventQueue.process('update-leaderboard', async (job) => {
  const { gameId } = job.data;
  
  // Recalcul en arrière-plan
  const leaderboard = await computeLeaderboard(gameId);
  await cache.set(`leaderboard:${gameId}`, leaderboard, 120);
  
  // Notification WebSocket des changements
  io.to(`game:${gameId}`).emit('leaderboard-updated', leaderboard);
});
```

### **API Response Patterns:**
```javascript
// Pattern de réponse standardisé
class APIResponse {
  static success(data, meta = {}) {
    return {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...meta
      }
    };
  }
  
  static paginated(data, pagination) {
    return {
      success: true,
      data,
      pagination: {
        total: pagination.total,
        page: pagination.page,
        limit: pagination.limit,
        hasNext: pagination.hasNext,
        cursor: pagination.nextCursor
      }
    };
  }
}
```

## 📊 Monitoring et observabilité

### **Métriques critiques:**
```javascript
// Middleware de métriques
class MetricsMiddleware {
  static async recordMetrics(req, res, next) {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      
      // Enregistrer les métriques
      metrics.record('api.request.duration', duration, {
        method: req.method,
        route: req.route?.path,
        status: res.statusCode,
        user_tier: getUserTier(req.user)
      });
      
      // Alertes en temps réel
      if (duration > 1000) {
        alerts.slowQuery(req.route?.path, duration);
      }
    });
    
    next();
  }
}
```

## 🔐 Sécurité renforcée

### **Rate limiting par endpoint:**
```javascript
const EndpointLimits = {
  'POST /api/auth/login': { rpm: 10, burst: 3 },
  'GET /api/games/*/leaderboard': { rpm: 30, burst: 10 },
  'POST /api/games/*/play': { rpm: 5, burst: 2 },
  'GET /api/events': { rpm: 100, burst: 20 }
};
```

### **Circuit Breaker Pattern:**
```javascript
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.threshold = threshold;
    this.timeout = timeout;
    this.failureCount = 0;
    this.lastFailTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }
  
  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}
```

## 🎯 Plan de migration

### **Phase 1: Optimisations immédiates (1 semaine)**
1. Éliminer les requêtes N+1 dans games-public.js
2. Implémenter pagination cursor-based
3. Optimiser le cache existant

### **Phase 2: Refactoring architecture (2 semaines)**
1. Séparer routes/controllers/services
2. Implémenter CQRS pattern
3. Ajouter circuit breakers

### **Phase 3: Scalabilité avancée (3 semaines)**
1. Event sourcing pour audit
2. Cache distribué multi-niveau
3. Monitoring et alertes automatisées

## 📈 Bénéfices attendus

- **Performance**: -80% temps de réponse
- **Scalabilité**: Support 100k+ utilisateurs
- **Fiabilité**: 99.9% uptime avec circuit breakers
- **Coûts**: -60% requêtes DB grâce au cache intelligent
- **Maintenance**: Code modulaire et testable

---

*Architecture conçue pour QR Event par Claude Code - Février 2026*
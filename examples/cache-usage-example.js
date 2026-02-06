/**
 * Cache Usage Examples
 * 
 * Exemples d'utilisation de la couche de cache dans les routes API.
 */

const cache = require('../utils/cache');
const { guests, events } = require('../utils/database');

// ============================================
// EXEMPLE 1: Cache simple avec getOrSet
// ============================================

/**
 * Récupère les invités avec mise en cache automatique
 */
async function getGuestsWithCache(eventId) {
  return cache.getOrSet(
    `guests:${eventId}`,
    async () => {
      // Cette fonction n'est appelée que si le cache est vide
      console.log('Fetching guests from database...');
      return await guests.findByEvent(eventId);
    },
    300 // TTL: 5 minutes
  );
}

// ============================================
// EXEMPLE 2: Invalidation de cache
// ============================================

/**
 * Met à jour un invité et invalide le cache
 */
async function updateGuestAndInvalidateCache(guestId, data) {
  // 1. Récupérer l'invité pour connaître son event_id
  const guest = await guests.findById(guestId);
  
  // 2. Mettre à jour en base
  const updated = await guests.update(guestId, data);
  
  // 3. Invalider le cache de la liste des invités de cet événement
  await cache.del(`guests:${guest.event_id}`);
  
  // 4. Invalider aussi le cache du dashboard
  await cache.delPattern(`dashboard:${guest.event_id}:*`);
  
  return updated;
}

// ============================================
// EXEMPLE 3: Cache avec tags pour invalidation groupée
// ============================================

/**
 * Récupère le dashboard avec plusieurs niveaux de cache
 */
async function getDashboardWithCaching(organizerId) {
  const cacheKey = `dashboard:summary:${organizerId}`;
  
  return cache.getOrSet(
    cacheKey,
    async () => {
      console.log('Computing dashboard...');
      
      // Récupérer les events
      const eventsList = await events.findByOrganizer(organizerId);
      
      // Récupérer les stats pour chaque event
      const eventsWithStats = await Promise.all(
        eventsList.map(async (event) => {
          // Utiliser le cache pour les guests aussi
          const guestsList = await cache.getOrSet(
            `guests:${event.id}:count`,
            async () => {
              const guests = await guests.findByEvent(event.id);
              return guests.length;
            },
            300
          );
          
          return {
            ...event,
            guestCount: guestsList
          };
        })
      );
      
      return {
        totalEvents: eventsList.length,
        events: eventsWithStats
      };
    },
    600 // TTL: 10 minutes
  );
}

// ============================================
// EXEMPLE 4: Cache dans une route Express
// ============================================

/**
 * Route Express avec cache
 */
function setupCachedRoutes(router) {
  
  // GET /api/events/:eventId/guests - Avec cache
  router.get('/events/:eventId/guests', async (req, res) => {
    try {
      const { eventId } = req.params;
      const { page = 1, limit = 50, refresh } = req.query;
      
      // Forcer le refresh si ?refresh=true
      if (refresh === 'true') {
        await cache.del(`guests:${eventId}:page:${page}`);
      }
      
      const cacheKey = `guests:${eventId}:page:${page}:limit:${limit}`;
      
      const result = await cache.getOrSet(
        cacheKey,
        async () => {
          return await guests.findByEvent(eventId, { page, limit });
        },
        300
      );
      
      res.json({
        success: true,
        data: result.data,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.count,
          totalPages: result.totalPages
        },
        cached: true
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });
  
  // POST /api/events/:eventId/guests - Invalider le cache après création
  router.post('/events/:eventId/guests', async (req, res) => {
    try {
      const { eventId } = req.params;
      
      // Créer l'invité
      const guest = await guests.create({
        ...req.body,
        event_id: eventId
      });
      
      // Invalider le cache de la liste
      await cache.delPattern(`guests:${eventId}:*`);
      
      res.status(201).json({
        success: true,
        data: guest
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });
}

// ============================================
// EXEMPLE 5: Middleware de cache
// ============================================

/**
 * Middleware Express pour cacher les réponses
 */
function cacheMiddleware(duration = 300) {
  return async (req, res, next) => {
    const cacheKey = `route:${req.method}:${req.originalUrl}`;
    
    try {
      // Essayer de récupérer du cache
      const cached = await cache.get(cacheKey);
      
      if (cached) {
        return res.json({
          ...cached,
          _cached: true,
          _cachedAt: new Date().toISOString()
        });
      }
      
      // Sinon, continuer et intercepter la réponse
      const originalJson = res.json.bind(res);
      
      res.json = (data) => {
        // Mettre en cache si succès
        if (data.success && res.statusCode < 400) {
          cache.set(cacheKey, data, duration).catch(console.error);
        }
        
        return originalJson(data);
      };
      
      next();
    } catch (error) {
      next();
    }
  };
}

// Utilisation:
// router.get('/dashboard/summary', cacheMiddleware(600), dashboardHandler);

// ============================================
// EXEMPLE 6: Warmup du cache
// ============================================

/**
 * Préchauffe le cache pour les données fréquemment accédées
 */
async function warmupCache() {
  console.log('Warming up cache...');
  
  // Liste des events à précharger
  const popularEvents = ['event-1', 'event-2', 'event-3'];
  
  for (const eventId of popularEvents) {
    try {
      // Précharger les invités
      const guestsList = await guests.findByEvent(eventId);
      await cache.set(`guests:${eventId}`, guestsList, 600);
      
      console.log(`Cached ${guestsList.length} guests for event ${eventId}`);
    } catch (error) {
      console.error(`Failed to warmup cache for ${eventId}:`, error.message);
    }
  }
  
  console.log('Cache warmup complete!');
}

// ============================================
// EXEMPLE 7: Stats du cache
// ============================================

async function printCacheStats() {
  const stats = await cache.getStats();
  console.log('Cache Statistics:');
  console.log(`  Connected: ${stats.connected}`);
  console.log(`  Keys: ${stats.keys}`);
  console.log(`  Hits: ${stats.hits}`);
  console.log(`  Misses: ${stats.misses}`);
  console.log(`  Hit Rate: ${stats.hitRate}`);
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  getGuestsWithCache,
  updateGuestAndInvalidateCache,
  getDashboardWithCaching,
  setupCachedRoutes,
  cacheMiddleware,
  warmupCache,
  printCacheStats
};

// Si exécuté directement, montrer les stats
if (require.main === module) {
  printCacheStats().then(() => process.exit(0));
}

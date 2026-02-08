const redis = require('ioredis');
const logger = require('../utils/logger');
const { supabaseService } = require('../config/supabase');

/**
 * 🧠 SYSTÈME DE CACHE INTELLIGENT MULTI-NIVEAU
 * 
 * Fonctionnalités:
 * - Cache probabiliste pour éviter cache stampedes
 * - TTL adaptatif selon les patterns d'usage
 * - Invalidation intelligente par domaine
 * - Fallback multi-niveau (Redis -> Memory -> DB)
 * - Preloading prédictif
 */

class IntelligentCacheService {
    constructor() {
        // Configuration Redis avec fallback
        this.redis = null;
        this.memoryCache = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            refreshes: 0,
            errors: 0
        };
        
        this.initRedis();
        this.startStatsReporting();
    }

    async initRedis() {
        try {
            this.redis = new redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD,
                retryDelayOnFailover: 100,
                enableOfflineQueue: false,
                maxRetriesPerRequest: 2,
                lazyConnect: true,
            });

            this.redis.on('error', (err) => {
                logger.warn('Redis error, falling back to memory cache:', err.message);
                this.stats.errors++;
            });

            this.redis.on('connect', () => {
                logger.info('Redis connected for intelligent caching');
            });
        } catch (error) {
            logger.warn('Redis initialization failed, using memory cache only:', error.message);
        }
    }

    /**
     * 🎯 CACHE PATTERNS SELON LE TYPE DE DONNÉES
     */
    static PATTERNS = {
        // Données statiques - cache longue durée
        STATIC: {
            ttl: 3600,      // 1 heure
            beta: 1,        // Probabilité de refresh
            tier: 'L3'      // CDN + Redis + Memory
        },
        
        // Profils utilisateur - cache moyenne durée
        USER_PROFILE: {
            ttl: 300,       // 5 minutes
            beta: 1.2,
            tier: 'L2'
        },
        
        // Listes d'événements - cache courte durée
        EVENTS_LIST: {
            ttl: 180,       // 3 minutes
            beta: 1.5,
            tier: 'L2'
        },
        
        // Classements en temps réel - cache très courte
        LEADERBOARD: {
            ttl: 30,        // 30 secondes
            beta: 2,        // Refresh agressif
            tier: 'L1',
            preload: true   // Preloading activé
        },
        
        // Stats dashboard - cache avec refresh intelligent
        DASHBOARD_STATS: {
            ttl: 120,       // 2 minutes
            beta: 1.8,
            tier: 'L2',
            compute: true   // Indique que c'est un calcul coûteux
        },
        
        // Données de jeu - cache adaptatif
        GAME_DATA: {
            ttl: 600,       // 10 minutes (les jeux changent peu)
            beta: 1,
            tier: 'L2'
        }
    };

    /**
     * 🚀 GET INTELLIGENT AVEC CACHE PROBABILISTE
     */
    async get(key, fetchFunction = null, pattern = 'USER_PROFILE', metadata = {}) {
        const startTime = Date.now();
        const config = IntelligentCacheService.PATTERNS[pattern] || IntelligentCacheService.PATTERNS.USER_PROFILE;
        
        try {
            // L1: Essayer Redis d'abord
            let cached = null;
            let ttl = 0;
            
            if (this.redis) {
                const multi = this.redis.multi();
                multi.get(key);
                multi.ttl(key);
                const [value, remainingTtl] = await multi.exec();
                
                if (value && value[1]) {
                    cached = JSON.parse(value[1]);
                    ttl = remainingTtl[1];
                }
            }
            
            // L2: Fallback mémoire
            if (!cached) {
                const memCached = this.memoryCache.get(key);
                if (memCached && memCached.expires > Date.now()) {
                    cached = memCached.data;
                    ttl = Math.floor((memCached.expires - Date.now()) / 1000);
                }
            }
            
            // Cache hit avec refresh probabiliste
            if (cached) {
                this.stats.hits++;
                
                // 🧠 PROBABILISTIC EARLY EXPIRATION (PER algorithm)
                const currentTime = Date.now() / 1000;
                const xfetch = Math.random() * config.beta * Math.log(currentTime);
                
                if (ttl > 0 && ttl > xfetch) {
                    // Cache encore valide
                    this.recordLatency('cache_hit', startTime);
                    return {
                        data: cached,
                        source: 'cache',
                        ttl: ttl
                    };
                } else if (fetchFunction && ttl > 0) {
                    // Refresh asynchrone en arrière-plan
                    this.refreshAsync(key, fetchFunction, config, metadata);
                    this.stats.refreshes++;
                    
                    this.recordLatency('cache_hit_refresh', startTime);
                    return {
                        data: cached,
                        source: 'cache_refreshing',
                        ttl: ttl
                    };
                }
            }
            
            // Cache miss - fetch fresh data
            if (fetchFunction) {
                this.stats.misses++;
                const fresh = await fetchFunction();
                
                await this.set(key, fresh, config.ttl);
                
                this.recordLatency('cache_miss', startTime);
                return {
                    data: fresh,
                    source: 'fresh',
                    ttl: config.ttl
                };
            }
            
            return { data: null, source: 'not_found', ttl: 0 };
            
        } catch (error) {
            logger.error('IntelligentCache.get error:', { 
                error: error.message, 
                key: key.substring(0, 50) // Truncate for safety
            });
            this.stats.errors++;
            
            // En cas d'erreur cache, essayer quand même fetchFunction
            if (fetchFunction) {
                try {
                    const fresh = await fetchFunction();
                    return { data: fresh, source: 'fallback', ttl: 0 };
                } catch (fetchError) {
                    logger.error('Cache fallback failed:', fetchError.message);
                    throw fetchError;
                }
            }
            
            throw error;
        }
    }

    /**
     * 💾 SET INTELLIGENT AVEC COMPRESSION
     */
    async set(key, data, ttl = 300, compress = true) {
        try {
            const serialized = JSON.stringify(data);
            
            // Compression pour gros objets
            const shouldCompress = compress && serialized.length > 1024;
            const value = shouldCompress ? 
                `compressed:${require('zlib').gzipSync(serialized).toString('base64')}` : 
                serialized;
            
            // Sauver dans Redis
            if (this.redis) {
                await this.redis.setex(key, ttl, value);
            }
            
            // Sauver en mémoire (avec limite de taille)
            if (this.memoryCache.size < 1000) { // Limite à 1000 entrées
                this.memoryCache.set(key, {
                    data: data,
                    expires: Date.now() + (ttl * 1000),
                    compressed: shouldCompress
                });
            }
            
            // Nettoyer la mémoire périodiquement
            this.cleanMemoryCache();
            
        } catch (error) {
            logger.warn('IntelligentCache.set error:', error.message);
            this.stats.errors++;
        }
    }

    /**
     * 🔄 REFRESH ASYNCHRONE EN ARRIÈRE-PLAN
     */
    async refreshAsync(key, fetchFunction, config, metadata = {}) {
        try {
            // Éviter les refreshs concurrents
            const lockKey = `lock:${key}`;
            const lockAcquired = await this.acquireLock(lockKey, 30); // 30 sec timeout
            
            if (!lockAcquired) {
                return; // Un autre processus est en train de refresh
            }
            
            const fresh = await fetchFunction();
            await this.set(key, fresh, config.ttl);
            
            await this.releaseLock(lockKey);
            
            logger.debug('Cache refreshed async:', { key: key.substring(0, 50), pattern: config });
            
        } catch (error) {
            logger.warn('Async refresh failed:', { error: error.message, key });
            await this.releaseLock(`lock:${key}`);
        }
    }

    /**
     * 🎯 INVALIDATION INTELLIGENTE PAR DOMAINE
     */
    async invalidatePattern(pattern, domain = null) {
        try {
            const patterns = this.buildInvalidationPatterns(pattern, domain);
            
            for (const pat of patterns) {
                // Redis
                if (this.redis) {
                    const keys = await this.redis.keys(pat);
                    if (keys.length > 0) {
                        await this.redis.del(...keys);
                        logger.debug(`Invalidated ${keys.length} Redis keys for pattern: ${pat}`);
                    }
                }
                
                // Memory cache
                for (const key of this.memoryCache.keys()) {
                    if (key.match(pat.replace('*', '.*'))) {
                        this.memoryCache.delete(key);
                    }
                }
            }
            
        } catch (error) {
            logger.warn('Pattern invalidation error:', error.message);
        }
    }

    /**
     * 🔮 PRELOADING PRÉDICTIF
     */
    async preload(gameId, eventId) {
        try {
            const predictions = [
                // Preloader le leaderboard avant la fin du jeu
                {
                    key: `leaderboard:${gameId}`,
                    fetchFn: () => this.fetchLeaderboard(gameId),
                    pattern: 'LEADERBOARD'
                },
                // Preloader les stats dashboard
                {
                    key: `dashboard:stats:${eventId}`,
                    fetchFn: () => this.fetchDashboardStats(eventId),
                    pattern: 'DASHBOARD_STATS'
                }
            ];
            
            for (const pred of predictions) {
                const cached = await this.get(pred.key);
                if (!cached.data) {
                    // Cache miss - preload en arrière-plan
                    setImmediate(() => {
                        this.get(pred.key, pred.fetchFn, pred.pattern)
                            .catch(err => logger.warn('Preload failed:', err.message));
                    });
                }
            }
            
        } catch (error) {
            logger.warn('Preloading failed:', error.message);
        }
    }

    /**
     * 📊 UTILITAIRES POUR LEADERBOARD ET STATS
     */
    async fetchLeaderboard(gameId) {
        // Requête optimisée avec jointures (élimine N+1)
        const { data, error } = await supabaseService
            .from('game_participations')
            .select(`
                id,
                total_score,
                correct_answers,
                total_answers,
                completed_at,
                player_name,
                player_type,
                rank,
                families!inner(name),
                guests!inner(first_name, last_name)
            `)
            .eq('game_id', gameId)
            .eq('is_completed', true)
            .order('total_score', { ascending: false })
            .order('completed_at', { ascending: true })
            .limit(100); // Raisonnable pour un leaderboard
        
        if (error) throw error;
        
        return data?.map((entry, index) => ({
            rank: entry.rank || index + 1,
            playerName: entry.player_name || 
                       (entry.families?.[0]?.name) ||
                       (entry.guests?.[0] ? `${entry.guests[0].first_name} ${entry.guests[0].last_name}` : 'Anonyme'),
            score: entry.total_score,
            correctAnswers: entry.correct_answers,
            totalAnswers: entry.total_answers,
            isTop3: index < 3
        })) || [];
    }

    async fetchDashboardStats(eventId) {
        // Utilise les vues matérialisées si disponibles
        const { data, error } = await supabaseService
            .rpc('get_dashboard_summary', { p_organizer_id: eventId });
        
        if (error) throw error;
        return data?.[0] || {};
    }

    /**
     * 🔒 LOCK MECHANISM POUR ÉVITER CACHE STAMPEDES
     */
    async acquireLock(key, timeout = 10) {
        if (!this.redis) return true; // Pas de lock sans Redis
        
        const lockValue = `${Date.now()}-${Math.random()}`;
        const result = await this.redis.set(key, lockValue, 'EX', timeout, 'NX');
        return result === 'OK';
    }

    async releaseLock(key) {
        if (!this.redis) return;
        await this.redis.del(key);
    }

    /**
     * 🧹 NETTOYAGE ET MAINTENANCE
     */
    cleanMemoryCache() {
        if (this.memoryCache.size <= 1000) return;
        
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, value] of this.memoryCache.entries()) {
            if (value.expires <= now) {
                this.memoryCache.delete(key);
                cleaned++;
            }
            
            // Nettoyer max 100 entrées à la fois
            if (cleaned >= 100) break;
        }
        
        logger.debug(`Cleaned ${cleaned} expired memory cache entries`);
    }

    buildInvalidationPatterns(pattern, domain) {
        const patterns = [pattern];
        
        if (domain) {
            patterns.push(`${domain}:*`);
        }
        
        // Patterns spécialisés
        switch (pattern) {
            case 'user_update':
                patterns.push(`user:profile:*`, `dashboard:stats:*`);
                break;
            case 'game_update':
                patterns.push(`leaderboard:*`, `game:*`);
                break;
            case 'event_update':
                patterns.push(`events:*`, `dashboard:*`);
                break;
        }
        
        return patterns;
    }

    recordLatency(operation, startTime) {
        const latency = Date.now() - startTime;
        
        // Log les latences élevées
        if (latency > 500) {
            logger.warn(`Slow cache operation: ${operation} took ${latency}ms`);
        }
    }

    /**
     * 📈 STATISTIQUES ET MONITORING
     */
    startStatsReporting() {
        setInterval(() => {
            const total = this.stats.hits + this.stats.misses;
            const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0;
            
            logger.info('Cache statistics:', {
                hitRate: `${hitRate}%`,
                hits: this.stats.hits,
                misses: this.stats.misses,
                refreshes: this.stats.refreshes,
                errors: this.stats.errors,
                memorySize: this.memoryCache.size
            });
            
            // Reset stats
            this.stats = { hits: 0, misses: 0, refreshes: 0, errors: 0 };
            
        }, 5 * 60 * 1000); // Toutes les 5 minutes
    }

    getStats() {
        const total = this.stats.hits + this.stats.misses;
        return {
            hitRate: total > 0 ? (this.stats.hits / total * 100) : 0,
            ...this.stats,
            memorySize: this.memoryCache.size,
            redisConnected: !!this.redis?.status
        };
    }
}

// Singleton instance
const intelligentCache = new IntelligentCacheService();

module.exports = {
    IntelligentCacheService,
    intelligentCache
};
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { circuitBreakers } = require('../utils/circuitBreaker');

// 🔥 FIX CRITIQUE: Configuration fetch avec timeout et retry
const fetchWithTimeout = (url, options = {}) => {
  const timeout = options.timeout || 10000; // 10 secondes par défaut
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));
};

// Options communes pour les clients Supabase
const supabaseOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    // Timeout de 10s pour toutes les requêtes
    fetch: (url, options) => fetchWithTimeout(url, { ...options, timeout: 10000 }),
  },
  db: {
    // Schema par défaut
    schema: 'public',
  },
};

// Create Supabase client with anon key for client-side operations
const supabaseAnon = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey,
  supabaseOptions
);

// Create Supabase client with service role key for server-side operations
const supabaseService = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  supabaseOptions
);

// 🔥 FIX CRITIQUE: Wrapper avec Circuit Breaker pour les opérations critiques
const wrapWithCircuitBreaker = (client, breakerName) => {
  const breaker = circuitBreakers[breakerName];
  if (!breaker) return client;
  
  // Proxy pour intercepter les appels .from()
  return new Proxy(client, {
    get(target, prop) {
      const value = target[prop];
      
      if (prop === 'from') {
        return (table) => {
          const query = target.from(table);
          
          // Wrapper les méthodes d'exécution avec circuit breaker
          const execMethods = ['select', 'insert', 'update', 'delete', 'upsert'];
          
          return new Proxy(query, {
            get(queryTarget, queryProp) {
              const queryValue = queryTarget[queryProp];
              
              // Si c'est une méthode de chaînage, retourner la méthode normalement
              if (typeof queryValue === 'function' && !['then', 'catch', 'finally'].includes(queryProp)) {
                if (execMethods.includes(queryProp)) {
                  // Pour les méthodes d'exécution, wrapper avec circuit breaker
                  return (...args) => {
                    const result = queryValue.apply(queryTarget, args);
                    // Si le résultat a une méthode then (c'est une promesse), wrapper l'exécution
                    if (result && typeof result.then === 'function') {
                      return breaker.execute(() => result);
                    }
                    return result;
                  };
                }
                // Pour les autres méthodes de chaînage (eq, filter, etc.), les proxy récursivement
                return (...args) => {
                  const result = queryValue.apply(queryTarget, args);
                  // Si le résultat est un objet avec des méthodes, continuer à le proxy
                  if (result && typeof result === 'object' && !result.then) {
                    return new Proxy(result, {
                      get(resultTarget, resultProp) {
                        const resultValue = resultTarget[resultProp];
                        if (typeof resultValue === 'function') {
                          if (execMethods.includes(resultProp)) {
                            return (...innerArgs) => {
                              const innerResult = resultValue.apply(resultTarget, innerArgs);
                              if (innerResult && typeof innerResult.then === 'function') {
                                return breaker.execute(() => innerResult);
                              }
                              return innerResult;
                            };
                          }
                          return resultValue.bind(resultTarget);
                        }
                        return resultValue;
                      }
                    });
                  }
                  return result;
                };
              }
              
              return queryValue;
            }
          });
        };
      }
      
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
};

// Clients avec circuit breaker (désactivé en développement pour éviter les conflits)
const isDevelopment = process.env.NODE_ENV === 'development';
const supabaseServiceSafe = isDevelopment ? supabaseService : wrapWithCircuitBreaker(supabaseService, 'supabase');

module.exports = {
  supabaseAnon,
  supabaseService: supabaseServiceSafe,
  supabaseServiceRaw: supabaseService, // Accès direct si nécessaire
  circuitBreakers
};
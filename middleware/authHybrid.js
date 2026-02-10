/**
 * Authentication Hybrid Middleware
 * 
 * Ce middleware implémente une stratégie d'authentification hybride:
 * 1. Essaie d'abord Supabase Auth (source de vérité)
 * 2. Si Supabase échoue (quota atteint, timeout, erreur réseau), fallback sur JWT local
 * 3. Permet à l'application de continuer à fonctionner même si Supabase est temporairement indisponible
 */

const jwt = require('jsonwebtoken');
const { supabaseService } = require('../config/supabase');
const config = require('../config/config');

// Helper to set cache-control headers for auth errors
const setAuthErrorHeaders = (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
};

/**
 * Extract access token from request
 * Checks Authorization header first, then cookies
 */
const extractToken = (req) => {
    // Check Authorization header (Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }

    // Check cookies (sb-access-token or access_token)
    if (req.cookies) {
        return req.cookies['sb-access-token'] ||
            req.cookies['access_token'] ||
            req.cookies['supabase-auth-token'];
    }

    return null;
};

/**
 * Vérifie si l'erreur Supabase est due à une indisponibilité du service
 * (quota atteint, timeout, erreur réseau, etc.)
 */
const isSupabaseUnavailable = (error) => {
    if (!error) return false;
    
    const errorMessage = error.message || error.toString() || '';
    const errorCode = error.code || '';
    
    // Erreurs réseau/DNS
    if (errorCode === 'EAI_AGAIN' || 
        errorCode === 'ENOTFOUND' || 
        errorCode === 'ECONNREFUSED' ||
        errorCode === 'ETIMEDOUT' ||
        errorMessage.includes('getaddrinfo') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ETIMEDOUT')) {
        return true;
    }
    
    // Erreurs Supabase spécifiques (quota, rate limit)
    if (errorMessage.includes('quota') ||
        errorMessage.includes('rate limit') ||
        errorMessage.includes('Too many requests') ||
        errorMessage.includes('503') ||
        errorMessage.includes('Service Unavailable')) {
        return true;
    }
    
    return false;
};

/**
 * Vérifie un token JWT localement
 * Retourne le payload décodé ou null si invalide
 */
const verifyLocalJWT = (token) => {
    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        return decoded;
    } catch (error) {
        console.log('[AuthHybrid] Local JWT verification failed:', error.message);
        return null;
    }
};

/**
 * Main authentication middleware - Hybrid Strategy
 */
const authenticateHybrid = async (req, res, next) => {
    try {
        // Skip if already authenticated
        if (req.user && req.user.id) {
            return next();
        }

        const token = extractToken(req);

        if (!token) {
            setAuthErrorHeaders(res);
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                code: 'NO_TOKEN'
            });
        }

        let supabaseError = null;
        let userProfile = null;
        let authUser = null;

        // ÉTAPE 1: Essayer Supabase Auth (source de vérité)
        try {
            const { data: { user: sbUser }, error: sbError } = await supabaseService.auth.getUser(token);
            
            if (!sbError && sbUser) {
                authUser = sbUser;
                console.log('[AuthHybrid] ✅ Authenticated via Supabase Auth');
            } else if (sbError) {
                supabaseError = sbError;
            }
        } catch (error) {
            supabaseError = error;
            console.warn('[AuthHybrid] Supabase Auth error:', error.message || error);
        }

        // ÉTAPE 2: Si Supabase échoue avec une erreur d'indisponibilité, fallback sur JWT local
        if (!authUser && supabaseError && isSupabaseUnavailable(supabaseError)) {
            console.warn('[AuthHybrid] ⚠️ Supabase unavailable, falling back to local JWT');
            
            const localPayload = verifyLocalJWT(token);
            
            if (localPayload && localPayload.sub) {
                // Construire un user à partir du JWT local
                authUser = {
                    id: localPayload.sub,
                    email: localPayload.email || '',
                    user_metadata: {
                        name: localPayload.name || ''
                    }
                };
                console.log('[AuthHybrid] ✅ Authenticated via local JWT fallback');
                
                // Marquer comme fallback pour le logging/tracking
                req.authFallback = true;
            }
        }

        // ÉTAPE 3: Si toujours pas d'authUser, retourner 401
        if (!authUser) {
            setAuthErrorHeaders(res);
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired session',
                code: 'INVALID_TOKEN'
            });
        }

        // ÉTAPE 4: Récupérer le profil utilisateur depuis la base de données
        try {
            const { data: profile, error: profileError } = await supabaseService
                .from('users')
                .select('*')
                .eq('auth_id', authUser.id)
                .single();

            if (!profileError && profile) {
                userProfile = profile;
            } else if (profileError && !isSupabaseUnavailable(profileError)) {
                // Erreur autre que indisponibilité
                console.error('[AuthHybrid] Profile fetch error:', profileError);
            }
        } catch (error) {
            console.warn('[AuthHybrid] Could not fetch profile from DB:', error.message);
        }

        // ÉTAPE 5: Si pas de profil en DB mais on a un authUser, créer un profil minimal
        if (!userProfile && authUser) {
            // En mode fallback JWT, on crée un profil minimal à la volée
            userProfile = {
                id: authUser.id,
                auth_id: authUser.id,
                email: authUser.email || '',
                name: authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User',
                role: authUser.user_metadata?.role || 'organizer',
                is_active: true
            };
            console.log('[AuthHybrid] Using minimal profile for user:', userProfile.id);
        }

        // ÉTAPE 6: Vérifier que l'utilisateur est actif
        if (userProfile && !userProfile.is_active) {
            setAuthErrorHeaders(res);
            return res.status(401).json({
                success: false,
                message: 'Account is deactivated',
                code: 'ACCOUNT_DEACTIVATED'
            });
        }

        // Attacher les données utilisateur à la requête
        if (userProfile) {
            req.user = {
                ...userProfile,
                id: String(userProfile.id).trim()
            };
        }
        
        req.supabaseUser = authUser;
        req.supabaseToken = token;

        next();

    } catch (error) {
        console.error('[AuthHybrid] Unexpected auth error:', error);
        setAuthErrorHeaders(res);
        return res.status(500).json({
            success: false,
            message: 'Authentication error',
            code: 'AUTH_ERROR'
        });
    }
};

/**
 * Optional authentication middleware
 * Attaches user if authenticated, but doesn't require it
 */
const optionalAuth = async (req, res, next) => {
    try {
        const token = extractToken(req);

        if (!token) {
            return next();
        }

        let authUser = null;

        // Essayer Supabase d'abord
        try {
            const { data: { user: sbUser }, error } = await supabaseService.auth.getUser(token);
            if (!error && sbUser) {
                authUser = sbUser;
            }
        } catch (error) {
            // Fallback JWT
            if (isSupabaseUnavailable(error)) {
                const localPayload = verifyLocalJWT(token);
                if (localPayload && localPayload.sub) {
                    authUser = {
                        id: localPayload.sub,
                        email: localPayload.email || ''
                    };
                }
            }
        }

        if (authUser) {
            // Essayer de récupérer le profil
            try {
                const { data: userProfile } = await supabaseService
                    .from('users')
                    .select('*')
                    .eq('auth_id', authUser.id)
                    .single();

                if (userProfile && userProfile.is_active) {
                    req.user = {
                        ...userProfile,
                        id: String(userProfile.id).trim()
                    };
                    req.supabaseUser = authUser;
                    req.supabaseToken = token;
                }
            } catch (error) {
                // Silently continue without full profile
            }
        }

        next();
    } catch (error) {
        // Silently continue without auth on error
        next();
    }
};

/**
 * Role-based authorization middleware
 */
const authorizeRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            setAuthErrorHeaders(res);
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                code: 'NOT_AUTHENTICATED'
            });
        }

        if (!roles.includes(req.user.role)) {
            setAuthErrorHeaders(res);
            return res.status(403).json({
                success: false,
                message: `Access denied. Role '${req.user.role}' is not authorized.`,
                code: 'FORBIDDEN'
            });
        }

        next();
    };
};

/**
 * Génère un token JWT local (utilisé pour le fallback)
 */
const generateLocalToken = (payload) => {
    return jwt.sign(payload, config.jwtSecret, {
        expiresIn: config.jwtExpire || '24h'
    });
};

module.exports = {
    authenticateHybrid,
    optionalAuth,
    authorizeRole,
    extractToken,
    setAuthErrorHeaders,
    generateLocalToken,
    isSupabaseUnavailable,
    verifyLocalJWT,
    
    // Backwards-compatible aliases
    authenticateToken: authenticateHybrid,
    authenticateSupabase: authenticateHybrid
};

/**
 * Supabase Auth Middleware
 * 
 * Validates Supabase Auth sessions and attaches user profile to request.
 * Replaces the old JWT-based auth middleware.
 */

const { supabaseService, supabaseAnon } = require('../config/supabase');
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
 * Main authentication middleware
 * Validates Supabase session and fetches user profile
 */
const authenticateSupabase = async (req, res, next) => {
    try {
        // Skip if already authenticated by another middleware
        if (req.user && req.supabaseUser) {
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

        // Verify the JWT with Supabase
        const { data: { user: authUser }, error: authError } = await supabaseService.auth.getUser(token);

        if (authError || !authUser) {
            setAuthErrorHeaders(res);
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired session',
                code: 'INVALID_TOKEN'
            });
        }

        // Fetch user profile from public.users using auth_id
        const { data: userProfile, error: profileError } = await supabaseService
            .from('users')
            .select('*')
            .eq('auth_id', authUser.id)
            .single();

        if (profileError || !userProfile) {
            // User exists in auth but not in public.users - this shouldn't happen
            // but we handle it gracefully by creating a minimal profile
            console.warn(`User ${authUser.id} exists in auth but not in public.users`);

            // Try to create the profile
            const { data: newProfile, error: createError } = await supabaseService
                .from('users')
                .insert({
                    auth_id: authUser.id,
                    email: authUser.email,
                    name: authUser.user_metadata?.name || authUser.email.split('@')[0],
                    role: authUser.user_metadata?.role || 'organizer',
                    is_active: true
                })
                .select()
                .single();

            if (createError) {
                console.error('Failed to create user profile:', createError);
                setAuthErrorHeaders(res);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to initialize user profile',
                    code: 'PROFILE_ERROR'
                });
            }

            req.user = {
                ...newProfile,
                id: String(newProfile.id).trim()
            };
        } else {
            // Check if user is active
            if (!userProfile.is_active) {
                setAuthErrorHeaders(res);
                return res.status(401).json({
                    success: false,
                    message: 'Account is deactivated',
                    code: 'ACCOUNT_DEACTIVATED'
                });
            }

            req.user = {
                ...userProfile,
                id: String(userProfile.id).trim()
            };
        }

        // Attach Supabase auth user for additional context
        req.supabaseUser = authUser;
        req.supabaseToken = token;

        next();
    } catch (error) {
        console.error('Supabase auth middleware error:', error);
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

        const { data: { user: authUser }, error } = await supabaseService.auth.getUser(token);

        if (!error && authUser) {
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
 * Refresh session middleware
 * Attempts to refresh the session if the access token is expired
 */
const refreshSession = async (req, res, next) => {
    try {
        const refreshToken = req.cookies?.['sb-refresh-token'] || req.cookies?.['refresh_token'];

        if (!refreshToken) {
            return next();
        }

        const { data, error } = await supabaseService.auth.refreshSession({
            refresh_token: refreshToken
        });

        if (!error && data.session) {
            // Set new tokens in cookies
            const isProduction = config.nodeEnv === 'production';

            res.cookie('sb-access-token', data.session.access_token, {
                httpOnly: true,
                secure: isProduction,
                sameSite: isProduction ? 'strict' : 'lax',
                maxAge: data.session.expires_in * 1000,
                path: '/'
            });

            res.cookie('sb-refresh-token', data.session.refresh_token, {
                httpOnly: true,
                secure: isProduction,
                sameSite: isProduction ? 'strict' : 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                path: '/'
            });
        }

        next();
    } catch (error) {
        // Continue even if refresh fails
        next();
    }
};

module.exports = {
    // New Supabase Auth exports
    authenticateSupabase,
    optionalAuth,
    authorizeRole,
    refreshSession,
    extractToken,
    setAuthErrorHeaders,

    // Backwards-compatible aliases (for existing routes using old naming)
    authenticateToken: authenticateSupabase,
    validateRequest: () => (req, res, next) => next(), // No-op for compatibility
};


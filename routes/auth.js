/**
 * Auth Routes - Supabase Auth Version
 * 
 * Routes for authentication using Supabase Auth.
 * Includes new endpoints for password reset and email confirmation.
 */

const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { authenticateSupabase, optionalAuth, refreshSession } = require('../middleware/auth');
const { authLimiter, generalLimiter } = require('../middleware/rateLimiter');
const { dashboardLimiter } = require('../middleware/security');
const { userProfileCache, autoInvalidateCache } = require('../middleware/cacheMiddleware');
const authController = require('../controllers/authController');

const router = express.Router();

// ============================================
// Validation schemas
// ============================================
const authValidation = {
    register: celebrate({
        [Segments.BODY]: Joi.object().keys({
            name: Joi.string().required().max(100).min(2),
            email: Joi.string().email().required(),
            password: Joi.string().min(8).required()
                .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
                .messages({
                    'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
                })
        })
    }),

    login: celebrate({
        [Segments.BODY]: Joi.object().keys({
            email: Joi.string().email().required(),
            password: Joi.string().required()
        })
    }),

    email: celebrate({
        [Segments.BODY]: Joi.object().keys({
            email: Joi.string().email().required()
        })
    }),

    password: celebrate({
        [Segments.BODY]: Joi.object().keys({
            password: Joi.string().min(8).required()
                .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
                .messages({
                    'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
                })
        })
    })
};

// ============================================
// Public routes with rate limiting
// ============================================

// Registration
router.post('/register', authLimiter, authValidation.register, authController.register);

// Login
router.post('/login', authLimiter, authValidation.login, authController.login);

// Password reset request
router.post('/forgot-password', authLimiter, authValidation.email, authController.forgotPassword);

// Password reset (requires valid reset token in cookie/header)
router.post('/reset-password', authLimiter, authValidation.password, authController.resetPassword);

// Resend email confirmation
router.post('/resend-confirmation', authLimiter, authValidation.email, authController.resendConfirmation);

// Refresh token
router.post('/refresh-token', generalLimiter, authController.refreshToken);

// ============================================
// Session check route - with JWT fallback
// ============================================
router.get('/session', generalLimiter, refreshSession, async (req, res) => {
    // 🔥 CRITICAL: Prevent caching of session checks
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
        // Try to extract and verify token
        const { extractToken, verifyLocalJWT, isSupabaseUnavailable } = require('../middleware/auth');
        const { supabaseService } = require('../config/supabase');

        const token = extractToken(req);

        if (!token) {
            return res.json({
                success: true,
                authenticated: false,
                message: 'No session token'
            });
        }

        let user = null;
        let supabaseError = null;

        // ÉTAPE 1: Essayer Supabase Auth
        try {
            const { data: { user: sbUser }, error } = await supabaseService.auth.getUser(token);
            if (!error && sbUser) {
                user = sbUser;
            } else if (error) {
                supabaseError = error;
            }
        } catch (error) {
            supabaseError = error;
        }

        // ÉTAPE 2: Fallback sur JWT local si Supabase est indisponible
        if (!user && supabaseError && isSupabaseUnavailable(supabaseError)) {
            console.warn('[Session] Supabase unavailable, checking local JWT fallback');
            const localPayload = verifyLocalJWT(token);
            if (localPayload && localPayload.sub) {
                user = { id: localPayload.sub };
                console.log('[Session] ✅ Authenticated via local JWT fallback');
            }
        }

        if (!user) {
            return res.json({
                success: true,
                authenticated: false,
                message: 'Session expired',
                canRefresh: !!req.cookies?.['sb-refresh-token']
            });
        }

        return res.json({
            success: true,
            authenticated: true,
            userId: user.id
        });
    } catch (error) {
        console.error('[Session] Error checking session:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// ============================================
// Protected routes
// ============================================

// Logout
router.post('/logout', authenticateSupabase, authController.logout);

// Get profile
router.get('/profile',
    dashboardLimiter,
    authenticateSupabase,
    userProfileCache,
    authController.getProfile
);

// Update profile
router.put('/profile',
    dashboardLimiter,
    authenticateSupabase,
    autoInvalidateCache(['user', 'events']),
    authController.updateProfile
);

module.exports = router;

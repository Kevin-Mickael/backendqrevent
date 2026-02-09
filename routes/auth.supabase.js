/**
 * Auth Routes - Supabase Auth Version
 * 
 * Routes for authentication using Supabase Auth.
 * Includes new endpoints for password reset and email confirmation.
 */

const express = require('express');
const { celebrate, Segments } = require('celebrate');
const Joi = require('joi');
const { authenticateSupabase, optionalAuth, refreshSession } = require('../middleware/supabaseAuth');
const { authLimiter, generalLimiter } = require('../middleware/rateLimiter');
const { dashboardLimiter, uploadLimiter } = require('../middleware/security');
const { userProfileCache, autoInvalidateCache } = require('../middleware/cacheMiddleware');
const upload = require('../middleware/upload');
const storageService = require('../services/storageService');
const { sanitizeFilename } = require('../utils/securityUtils');
const logger = require('../utils/logger');
const { redisService, imageProcessingQueue } = require('../services/redisService');
const authController = require('../controllers/authController.supabase');

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
// Session check route
// ============================================
router.get('/session', generalLimiter, refreshSession, async (req, res) => {
    try {
        // Try to extract and verify token
        const { extractToken } = require('../middleware/supabaseAuth');
        const { supabaseService } = require('../config/supabase');

        const token = extractToken(req);

        if (!token) {
            return res.json({
                success: true,
                authenticated: false,
                message: 'No session token'
            });
        }

        const { data: { user }, error } = await supabaseService.auth.getUser(token);

        if (error || !user) {
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

// ============================================
// Avatar upload endpoint
// ============================================
router.post('/upload-avatar',
    uploadLimiter,
    authenticateSupabase,
    upload.single('avatar'),
    autoInvalidateCache(['user']),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No avatar file provided'
                });
            }

            // Validate file type
            if (!req.file.mimetype.startsWith('image/')) {
                return res.status(400).json({
                    success: false,
                    message: 'Only image files are allowed'
                });
            }

            // Validate file size (2MB max)
            const maxSize = 2 * 1024 * 1024; // 2MB
            if (req.file.size > maxSize) {
                return res.status(400).json({
                    success: false,
                    message: 'File size too large. Maximum size is 2MB'
                });
            }

            logger.info('Avatar upload request', {
                userId: req.user.id,
                fileSize: req.file.size,
                mimeType: req.file.mimetype,
                originalName: sanitizeFilename(req.file.originalname)
            });

            // Upload file directly (always synchronous for avatars)
            const processedUrl = await storageService.uploadFile(req.file, 'avatars');

            // Update user profile with new avatar URL using Supabase service
            const supabaseAuthService = require('../services/supabaseAuthService');
            await supabaseAuthService.updateProfile(req.supabaseUser.id, {
                avatar_url: processedUrl
            });

            logger.info('Avatar uploaded successfully', {
                userId: req.user.id,
                url: processedUrl
            });

            res.json({
                success: true,
                message: 'Avatar uploaded successfully',
                url: processedUrl,
                processing: false
            });
        } catch (error) {
            logger.error('Error uploading avatar:', { error: error.message });
            res.status(500).json({
                success: false,
                message: 'Server error while uploading avatar'
            });
        }
    }
);

// ============================================
// Delete avatar endpoint
// ============================================
router.delete('/avatar',
    uploadLimiter,
    authenticateSupabase,
    autoInvalidateCache(['user']),
    async (req, res) => {
        try {
            // Get current user profile to find avatar URL
            const supabaseAuthService = require('../services/supabaseAuthService');
            const profile = await supabaseAuthService.getProfileByAuthId(req.supabaseUser.id);
            
            if (profile?.avatar_url) {
                // Delete file from storage
                try {
                    await storageService.deleteFile(profile.avatar_url);
                    logger.info('Avatar deleted from storage', { userId: req.user.id });
                } catch (deleteError) {
                    logger.warn('Failed to delete avatar from storage, continuing...', { error: deleteError.message });
                    // Continue even if storage deletion fails
                }
            }

            // Update user profile to remove avatar URL
            await supabaseAuthService.updateProfile(req.supabaseUser.id, {
                avatar_url: null
            });

            logger.info('Avatar removed successfully', { userId: req.user.id });

            res.json({
                success: true,
                message: 'Avatar removed successfully'
            });
        } catch (error) {
            logger.error('Error removing avatar:', { error: error.message, stack: error.stack });
            res.status(500).json({
                success: false,
                message: 'Server error while removing avatar',
                error: error.message
            });
        }
    }
);

module.exports = router;
